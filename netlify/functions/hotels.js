// Netlify Function: Hotellook API (Travelpayouts)
// Due endpoint:
//   /api/hotels?city=BUD&checkIn=2026-05-10&checkOut=2026-05-13   → prezzi cached
//   /api/hotels?city=BUD&mode=lookup                               → city ID lookup

const TOKEN = "29e331be9373b8ccd6c7d6eb47082305";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Mappa IATA → city name per lookup (fallback se lookup API non risponde)
const CITY_NAMES = {
  BCN:"Barcelona", MAD:"Madrid", LIS:"Lisbon", OPO:"Porto",
  ATH:"Athens", BUD:"Budapest", PRG:"Prague", WAW:"Warsaw",
  KRK:"Krakow", VIE:"Vienna", AMS:"Amsterdam", DUB:"Dublin",
  EDI:"Edinburgh", STN:"London", LGW:"London", LHR:"London",
  CMN:"Casablanca", RAK:"Marrakech", IST:"Istanbul",
  DXB:"Dubai", DOH:"Doha", AUH:"Abu Dhabi", CAI:"Cairo",
  SOF:"Sofia", OTP:"Bucharest", SKP:"Skopje", TIA:"Tirana",
  TGD:"Podgorica", LCA:"Larnaca", NBO:"Nairobi", ADD:"Addis Ababa",
  JNB:"Johannesburg", LOS:"Lagos", BOM:"Mumbai", DEL:"Delhi",
  GRU:"Sao Paulo", RIX:"Riga", TLL:"Tallinn", HEL:"Helsinki",
  CPH:"Copenhagen", BRU:"Brussels", PMI:"Palma", IBZ:"Ibiza",
  AGP:"Malaga", RHO:"Rhodes", HER:"Heraklion", TLV:"Tel Aviv",
  AMM:"Amman", RUH:"Riyadh", KWI:"Kuwait City",
};


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
  const { city, checkIn, checkOut, mode, nights } = event.queryStringParameters || {};

  if (!city) {
    return { statusCode: 400, headers: HEADERS,
      body: JSON.stringify({ error: "Parametro 'city' mancante" }) };
  }

  try {
    // Step 1: Ottieni city ID da IATA code via lookup
    const cityName = CITY_NAMES[city] || city;
    const lookupUrl = `https://engine.hotellook.com/api/v2/lookup.json` +
      `?query=${encodeURIComponent(cityName)}&lang=it&lookFor=city&limit=1&token=${TOKEN}`;

    const lookupRes = await fetch(lookupUrl, {
      signal: AbortSignal.timeout(8000)
    });

    if (!lookupRes.ok) throw new Error(`Lookup HTTP ${lookupRes.status}`);
    const lookupData = await lookupRes.json();

    if (mode === "lookup") {
      // Ritorna solo il city ID per uso futuro
      return { statusCode: 200, headers: HEADERS,
        body: JSON.stringify(lookupData) };
    }

    const cityId = lookupData?.results?.locations?.[0]?.id
      || lookupData?.results?.hotels?.[0]?.locationId;

    if (!cityId) {
      return { statusCode: 200, headers: HEADERS,
        body: JSON.stringify({ hotels: [], noData: true, city }) };
    }

    // Step 2: Ottieni prezzi cached hotel
    if (!checkIn || !checkOut) {
      return { statusCode: 400, headers: HEADERS,
        body: JSON.stringify({ error: "checkIn e checkOut richiesti" }) };
    }

    const nightsCount = nights ? parseInt(nights) : Math.round(
      (new Date(checkOut) - new Date(checkIn)) / (1000*60*60*24)
    );

    const cacheUrl = `https://engine.hotellook.com/api/v2/cache.json` +
      `?location=${cityId}&checkIn=${checkIn}&checkOut=${checkOut}` +
      `&currency=eur&limit=8&token=${TOKEN}`;

    const cacheRes = await fetch(cacheUrl, {
      signal: AbortSignal.timeout(10000)
    });

    if (!cacheRes.ok) throw new Error(`Cache HTTP ${cacheRes.status}`);
    const cacheData = await cacheRes.json();

    if (!Array.isArray(cacheData) || cacheData.length === 0) {
      return { statusCode: 200, headers: HEADERS,
        body: JSON.stringify({ hotels: [], noData: true, city, cityId }) };
    }

    // Normalizza risposta
    const hotels = cacheData
      .filter(h => h.priceFrom)
      .map(h => ({
        id: h.id,
        name: h.name || "Hotel",
        stars: h.stars || 0,
        rating: h.guestScore ? Math.round(h.guestScore / 10) : null,
        pricePerNight: Math.round(h.priceFrom),
        totalPrice: Math.round(h.priceFrom * nightsCount),
        nights: nightsCount,
        city,
        photoUrl: h.photoUrl || null,
        bookingUrl: `https://www.hotellook.com/hotels?destination=${cityId}&checkIn=${checkIn}&checkOut=${checkOut}&adults=1&token=${TOKEN}`,
        directUrl: h.url || null,
      }))
      .sort((a, b) => a.pricePerNight - b.pricePerNight);

    // Statistiche utili per il calcolo costo totale viaggio
    const minPrice = hotels[0]?.pricePerNight || 0;
    const avgPrice = Math.round(hotels.reduce((s,h) => s+h.pricePerNight, 0) / hotels.length);

    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({
        hotels: hotels.slice(0, 5), // top 5 più economici
        meta: { minPricePerNight: minPrice, avgPricePerNight: avgPrice,
          nights: nightsCount, minTotal: minPrice * nightsCount,
          avgTotal: avgPrice * nightsCount, city, cityId }
      })
    };

  } catch (err) {
    return { statusCode: 500, headers: HEADERS,
      body: JSON.stringify({ error: err.message, city }) };
  }
};
