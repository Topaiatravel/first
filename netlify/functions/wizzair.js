// Netlify Function: proxy verso Wizz Air timetable API
// Endpoint: /api/wizzair?from=MXP&to=BUD&month=2026-06
// Nessuna API key richiesta — endpoint non ufficiale ma stabile

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Versione API Wizz Air — aggiornare se smette di funzionare
// Storia: 10.1 → 12.3 → 14.8 → 15.9 → 17.8 → 19.x
const WIZZ_API_VERSION = "19.8.0";

// Rileva versione corrente dalla homepage (fallback se quella hardcoded non funziona)
async function detectWizzVersion() {
  try {
    const res = await fetch("https://wizzair.com/en-gb/flights/timetable", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; topaia.travel/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    const html = await res.text();
    // Cerca pattern come "apiUrl":"https://be.wizzair.com/19.8.0"
    const match = html.match(/be\.wizzair\.com\/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch (_) {}
  return WIZZ_API_VERSION; // fallback alla versione hardcoded
}


// ── Rate limit guard (server-side, seconda linea di difesa) ──────────────
const _reqStore = {};
function serverRateCheck(ip, limit = 20, windowSec = 60) {
  const ts = Math.floor(Date.now() / 1000);
  const k = `${ip}_${Math.floor(ts / windowSec)}`;
  _reqStore[k] = (_reqStore[k] || 0) + 1;
  // Pulizia vecchie chiavi
  Object.keys(_reqStore).forEach(key => {
    if (!key.endsWith(`_${Math.floor(ts/windowSec)}`)) delete _reqStore[key];
  });
  return _reqStore[k] <= limit;
}

exports.handler = async (event) => {
  // Server-side rate limit: 20 req/min per IP
  const clientIp = event.headers["x-nf-client-connection-ip"]
    || event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!serverRateCheck(clientIp, 20, 60)) {
    return { statusCode: 429,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Rate limit exceeded" }) };
  }
  const { from, to, month } = event.queryStringParameters || {};

  if (!from || !to || !month) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Parametri mancanti: from, to, month (YYYY-MM)" }),
    };
  }

  // Costruisce range date per il mese richiesto
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const dateFrom = `${month}-01`;
  const dateTo = `${month}-${lastDay}`;

  let version = WIZZ_API_VERSION;

  try {
    // Prova prima con la versione hardcoded, poi rileva dinamicamente se fallisce
    const baseUrl = `https://be.wizzair.com/${version}/Api/search/timetable`;

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

    let response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Origin": "https://wizzair.com",
        "Referer": "https://wizzair.com/",
        "x-requestid": crypto.randomUUID?.() || `topaia-${Date.now()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    // Se 404, prova a rilevare la versione corrente
    if (response.status === 404 || response.status === 400) {
      version = await detectWizzVersion();
      if (version !== WIZZ_API_VERSION) {
        response = await fetch(
          `https://be.wizzair.com/${version}/Api/search/timetable`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json, text/plain, */*",
              "Origin": "https://wizzair.com",
              "Referer": "https://wizzair.com/",
              "x-requestid": crypto.randomUUID?.() || `topaia-${Date.now()}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
          }
        );
      }
    }

    if (!response.ok) {
      // Rotta non operata da Wizz su questo aeroporto
      if (response.status === 404 || response.status === 204) {
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ flights: [], noRoute: true, from, to }),
        };
      }
      throw new Error(`Wizz Air HTTP ${response.status}`);
    }

    const data = await response.json();

    // Risposta Wizz: { outboundFlights: [{departureStation, arrivalStation, departureDate,
    //   arrivalDate, price: {amount, currencyCode}, departure/arrivalTime, ...}] }
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
