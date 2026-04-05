// fetch-deals.js — Netlify Scheduled Function
// Esegue ogni 12 ore, raccoglie offerte reali e le salva in Netlify Blobs
// Costo: €0 (usa solo API gratuite: Aviasales special_offers + Ryanair cheapestPerDay)
//
// Schedule: alle 06:00 e 18:00 UTC (07:00 e 19:00 ora italiana)

const { schedule } = require("@netlify/functions");
const { getStore } = require("@netlify/blobs");

const AVIASALES_TOKEN = "29e331be9373b8ccd6c7d6eb47082305";

// Aeroporti da monitorare (i principali italiani)
const AIRPORTS = ["FCO", "MXP", "BGY", "NAP", "VCE", "BLQ"];

// Rotte Ryanair popolari da monitorare per prezzi bassi
const RYANAIR_WATCH = [
  { from: "FCO", to: "BCN" }, { from: "FCO", to: "MAD" },
  { from: "MXP", to: "ATH" }, { from: "MXP", to: "LIS" },
  { from: "BGY", to: "BUD" }, { from: "BGY", to: "PRG" },
  { from: "NAP", to: "BCN" }, { from: "VCE", to: "WAW" },
];

// Info destinazioni per enrichment
const DEST_INFO = {
  BCN:{city:"Barcellona",country:"Spagna",flag:"🇪🇸"},
  MAD:{city:"Madrid",country:"Spagna",flag:"🇪🇸"},
  LIS:{city:"Lisbona",country:"Portogallo",flag:"🇵🇹"},
  ATH:{city:"Atene",country:"Grecia",flag:"🇬🇷"},
  BUD:{city:"Budapest",country:"Ungheria",flag:"🇭🇺"},
  PRG:{city:"Praga",country:"Rep. Ceca",flag:"🇨🇿"},
  WAW:{city:"Varsavia",country:"Polonia",flag:"🇵🇱"},
  VIE:{city:"Vienna",country:"Austria",flag:"🇦🇹"},
  AMS:{city:"Amsterdam",country:"Olanda",flag:"🇳🇱"},
  CMN:{city:"Casablanca",country:"Marocco",flag:"🇲🇦"},
  DXB:{city:"Dubai",country:"EAU",flag:"🇦🇪"},
  DOH:{city:"Doha",country:"Qatar",flag:"🇶🇦"},
  IST:{city:"Istanbul",country:"Turchia",flag:"🇹🇷"},
  OPO:{city:"Porto",country:"Portogallo",flag:"🇵🇹"},
  KRK:{city:"Cracovia",country:"Polonia",flag:"🇵🇱"},
  DUB:{city:"Dublino",country:"Irlanda",flag:"🇮🇪"},
  EDI:{city:"Edimburgo",country:"UK",flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿"},
  SOF:{city:"Sofia",country:"Bulgaria",flag:"🇧🇬"},
  OTP:{city:"Bucarest",country:"Romania",flag:"🇷🇴"},
  TIA:{city:"Tirana",country:"Albania",flag:"🇦🇱"},
};

const AIRPORT_NAMES = {
  FCO:"Roma", MXP:"Milano Malpensa", BGY:"Bergamo",
  NAP:"Napoli", VCE:"Venezia", BLQ:"Bologna",
  PSA:"Pisa", BRI:"Bari", PMO:"Palermo", TRN:"Torino",
};

function today() {
  return new Date().toISOString().split("T")[0];
}
function nextMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0,7);
}

// ── Fetch Aviasales special offers per aeroporto ──────────────────────────
async function fetchSpecialOffers(from) {
  try {
    const url = `https://api.travelpayouts.com/aviasales/v3/get_special_offers` +
      `?origin=${from}&currency=eur&locale=it&token=${AVIASALES_TOKEN}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.success || !data.data?.length) return [];

    return data.data
      .filter(o => o.price && o.depart_date && o.destination)
      .map(o => {
        const d = DEST_INFO[o.destination] || { city: o.destination, country: "—", flag: "✈" };
        return {
          source: "aviasales_flash",
          from, fromName: AIRPORT_NAMES[from] || from,
          to: o.destination,
          ...d,
          price: o.price,
          depDate: o.depart_date,
          retDate: o.return_date || null,
          airline: o.airline || "—",
          stops: o.number_of_changes || 0,
          link: o.link ? `https://www.aviasales.com/search/${o.link}` : null,
          isFlash: true,
        };
      });
  } catch { return []; }
}

// ── Fetch Ryanair cheapestPerDay su rotta specifica ───────────────────────
async function fetchRyanairRoute(from, to) {
  try {
    const month = nextMonth();
    const url = `https://www.ryanair.com/api/farfnd/v4/roundTripFares/${from}/${to}/cheapestPerDay` +
      `?market=it-it&outboundMonthOfDate=${month}-01&inboundMonthOfDate=${month}-01&currency=EUR`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const outFares = data.outbound?.fares || [];
    const best = outFares
      .filter(f => f.price?.value && !f.unavailable && !f.soldOut)
      .sort((a, b) => a.price.value - b.price.value)[0];

    if (!best) return null;
    const d = DEST_INFO[to] || { city: to, country: "—", flag: "✈" };
    return {
      source: "ryanair",
      from, fromName: AIRPORT_NAMES[from] || from,
      to, ...d,
      price: Math.round(best.price.value * 2), // stima A/R
      depDate: best.day,
      retDate: null,
      airline: "Ryanair",
      stops: 0,
      link: `https://www.ryanair.com/it/it/trip/flights/select?adults=1&teens=0&children=0&infants=0&dateOut=${best.day}&isReturn=true&discount=0&promoCode=&originIata=${from}&destinationIata=${to}`,
      isFlash: false,
    };
  } catch { return null; }
}

// ── Selezione e scoring delle offerte migliori ────────────────────────────
function scoreDeals(all) {
  // Ordina per prezzo assoluto, poi dedup per destinazione
  const sorted = [...all]
    .filter(d => d.price > 0 && d.price < 500)
    .sort((a, b) => a.price - b.price);

  const seen = new Set();
  const unique = [];
  for (const deal of sorted) {
    const key = `${deal.from}-${deal.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(deal);
    }
    if (unique.length >= 8) break;
  }
  return unique;
}

// ── Handler principale ────────────────────────────────────────────────────
const handler = async (event) => {
  console.log("[fetch-deals] Starting at", new Date().toISOString());
  const allDeals = [];

  // 1. Special offers da tutti gli aeroporti principali (parallelo)
  const specialResults = await Promise.allSettled(
    AIRPORTS.map(apt => fetchSpecialOffers(apt))
  );
  specialResults.forEach(r => {
    if (r.status === "fulfilled") r.value.forEach(d => allDeals.push(d));
  });
  console.log(`[fetch-deals] Special offers: ${allDeals.length} deals`);

  // 2. Ryanair cheapest su rotte watch (parallelo, max 8 call)
  const ryanairResults = await Promise.allSettled(
    RYANAIR_WATCH.map(r => fetchRyanairRoute(r.from, r.to))
  );
  ryanairResults.forEach(r => {
    if (r.status === "fulfilled" && r.value) allDeals.push(r.value);
  });
  console.log(`[fetch-deals] After Ryanair: ${allDeals.length} deals total`);

  // 3. Seleziona le migliori 8
  const topDeals = scoreDeals(allDeals);
  console.log(`[fetch-deals] Top deals: ${topDeals.length}`);

  const snapshot = {
    deals: topDeals,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 13 * 3600 * 1000).toISOString(), // 13h
    count: topDeals.length,
    airports: [...new Set(topDeals.map(d => d.from))],
  };

  // 4. Salva su Netlify Blobs
  try {
    const store = getStore("topaia-deals");
    await store.setJSON("deals_snapshot", snapshot);
    console.log("[fetch-deals] Saved to Netlify Blobs ✓");
  } catch (e) {
    console.error("[fetch-deals] Blobs save failed:", e.message);
    // Fallback: salva come variabile d'ambiente non è possibile,
    // ma il frontend gestisce l'assenza di dati
  }

  return { statusCode: 200 };
};

// Schedule: 06:00 e 18:00 UTC ogni giorno
module.exports.handler = schedule("0 6,18 * * *", handler);
