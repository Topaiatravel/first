// Netlify Function: proxy verso Wizz Air timetable API
// Endpoint: /api/wizzair?from=MXP&to=BUD&month=2026-06
// Nessuna API key richiesta — endpoint non ufficiale
//
// VERSIONE AUTO-DETECT: non serve più aggiornare manualmente.
// Lo script prova la versione cached, se fallisce ne cerca una nuova
// usando 3 strategie diverse. La versione trovata resta in memoria
// fino al prossimo cold start di Netlify (~15 min inattività).

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// ── Versione API — auto-aggiornante ─────────────────────────────────────
// Ultimo valore noto (aggiornato manualmente come fallback estremo)
// Storia: 10.1 → 12.3 → 14.8 → 15.9 → 17.8 → 19.8 → 28.5
const FALLBACK_VERSION = "28.5.0";

// Cache in memoria (persiste tra invocazioni nello stesso container)
let _cachedVersion = null;
let _cacheTime = 0;
const CACHE_TTL = 6 * 3600 * 1000; // 6 ore — poi ritesta

// Headers comuni per sembrare un browser reale
function wizzHeaders() {
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "Origin": "https://wizzair.com",
    "Referer": "https://wizzair.com/",
    "x-requestid": crypto.randomUUID?.() || `topaia-${Date.now()}`,
  };
}

// ── STRATEGIA 1: Testa se una versione specifica funziona ───────────────
// Usa l'endpoint asset/map che è un GET leggero (non POST pesante)
async function testVersion(v) {
  try {
    const res = await fetch(
      `https://be.wizzair.com/${v}/Api/asset/map?languageCode=en-gb`,
      {
        headers: { "User-Agent": wizzHeaders()["User-Agent"] },
        signal: AbortSignal.timeout(4000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── STRATEGIA 2: Scrape versione dalla homepage Wizz ────────────────────
async function detectFromHomepage() {
  try {
    const res = await fetch("https://wizzair.com/en-gb/flights/timetable", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Cerca pattern: be.wizzair.com/28.5.0 o simile
    const match = html.match(/be\.wizzair\.com\/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── STRATEGIA 3: Probe incrementale (brute force leggero) ───────────────
// Prova major versions intorno a quella nota, minor 0-10
async function probeVersions(knownMajor) {
  // Prova prima intorno alla versione nota (±5 major)
  const candidates = [];
  for (let m = knownMajor + 10; m >= Math.max(knownMajor - 3, 20); m--) {
    for (const minor of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      candidates.push(`${m}.${minor}.0`);
    }
  }

  // Testa in parallelo a batch di 5 per non sovraccaricare
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async v => ({ v, ok: await testVersion(v) }))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        return r.value.v;
      }
    }
  }
  return null;
}

// ── ORCHESTRATORE: trova la versione funzionante ────────────────────────
async function getWorkingVersion() {
  // Se abbiamo una versione cached recente, usala
  if (_cachedVersion && (Date.now() - _cacheTime) < CACHE_TTL) {
    return _cachedVersion;
  }

  const knownMajor = parseInt((_cachedVersion || FALLBACK_VERSION).split(".")[0]);

  // Step 1: Testa la versione cached/fallback
  const current = _cachedVersion || FALLBACK_VERSION;
  if (await testVersion(current)) {
    _cachedVersion = current;
    _cacheTime = Date.now();
    return current;
  }

  console.log(`[wizzair] Versione ${current} non funziona, cerco nuova...`);

  // Step 2: Scrape dalla homepage
  const scraped = await detectFromHomepage();
  if (scraped && await testVersion(scraped)) {
    console.log(`[wizzair] Trovata da homepage: ${scraped}`);
    _cachedVersion = scraped;
    _cacheTime = Date.now();
    return scraped;
  }

  // Step 3: Probe incrementale
  console.log(`[wizzair] Homepage fallito, provo probe da major ${knownMajor}...`);
  const probed = await probeVersions(knownMajor);
  if (probed) {
    console.log(`[wizzair] Trovata da probe: ${probed}`);
    _cachedVersion = probed;
    _cacheTime = Date.now();
    return probed;
  }

  // Nessuna strategia ha funzionato
  console.error(`[wizzair] NESSUNA versione trovata! Uso fallback ${FALLBACK_VERSION}`);
  return FALLBACK_VERSION;
}


// ── Rate limit guard ────────────────────────────────────────────────────
const _reqStore = {};
function serverRateCheck(ip, limit = 20, windowSec = 60) {
  const ts = Math.floor(Date.now() / 1000);
  const k = `${ip}_${Math.floor(ts / windowSec)}`;
  _reqStore[k] = (_reqStore[k] || 0) + 1;
  Object.keys(_reqStore).forEach(key => {
    if (!key.endsWith(`_${Math.floor(ts / windowSec)}`)) delete _reqStore[key];
  });
  return _reqStore[k] <= limit;
}


// ── Handler principale ──────────────────────────────────────────────────
exports.handler = async (event) => {
  // Rate limit
  const clientIp = event.headers["x-nf-client-connection-ip"]
    || event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!serverRateCheck(clientIp, 20, 60)) {
    return {
      statusCode: 429,
      headers: HEADERS,
      body: JSON.stringify({ error: "Rate limit exceeded" }),
    };
  }

  const { from, to, month } = event.queryStringParameters || {};

  if (!from || !to || !month) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Parametri mancanti: from, to, month (YYYY-MM)" }),
    };
  }

  // Range date per il mese richiesto
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const dateFrom = `${month}-01`;
  const dateTo = `${month}-${lastDay}`;

  try {
    // ── Trova versione funzionante ──
    const version = await getWorkingVersion();
    const url = `https://be.wizzair.com/${version}/Api/search/timetable`;

    const body = {
      flightList: [{
        departureStation: from,
        arrivalStation: to,
        from: dateFrom,
        to: dateTo,
      }],
      priceType: "regular",
      adultCount: 1,
      childCount: 0,
      infantCount: 0,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: wizzHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    // Rotta non operata
    if (response.status === 404 || response.status === 204) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ flights: [], noRoute: true, from, to }),
      };
    }

    // Se la versione "funzionante" ritorna 403 o altro errore inaspettato,
    // potrebbe essere cambiata nel frattempo — invalida la cache
    if (!response.ok) {
      if (response.status === 403 || response.status === 400) {
        console.log(`[wizzair] HTTP ${response.status} — invalido cache versione`);
        _cachedVersion = null;
        _cacheTime = 0;
      }
      throw new Error(`Wizz Air HTTP ${response.status}`);
    }

    const data = await response.json();

    // Parse voli
    const flights = (data.outboundFlights || [])
      .filter(f => f.price?.amount)
      .map(f => ({
        depDate: f.departureDate?.split("T")[0],
        depTime: f.departureTime || "—",
        arrTime: f.arrivalTime || "—",
        price: Math.round(f.price.amount),
        currency: f.price.currencyCode || "EUR",
        soldOut: f.isSoldOut || false,
        duration: f.duration || null,
      }))
      .filter(f => f.depDate && !f.soldOut);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ flights, from, to, month, version }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message, from, to }),
    };
  }
};
