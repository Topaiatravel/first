// Netlify Function: proxy verso Ryanair cheapestPerDay API
// Endpoint: /api/ryanair?from=MXP&to=BCN&month=2026-06
// Ryanair API è pubblica, no key necessaria


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
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const { from, to, month } = event.queryStringParameters || {};

  if (!from || !to || !month) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Parametri mancanti: from, to, month (YYYY-MM)" }),
    };
  }

  // Calcola mese di ritorno (stesso mese o successivo)
  const [year, mon] = month.split("-").map(Number);
  const nextMon = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;

  const url = `https://www.ryanair.com/api/farfnd/v4/roundTripFares/${from}/${to}/cheapestPerDay` +
    `?outboundMonthOfDate=${month}-01&inboundMonthOfDate=${month}-01&currency=EUR&market=it-it`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; topaia.travel)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Ryanair 404 = rotta non operata da Ryanair
      if (response.status === 404) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ outbound: [], noRoute: true }),
        };
      }
      throw new Error(`Ryanair HTTP ${response.status}`);
    }

    const data = await response.json();

    // Normalizza risposta Ryanair → formato comune Topaia
    // data.outbound = array di { departureDate, price: { value, currencyCode } }
    const outbound = (data.outbound || []).map(d => ({
      date: d.departureDate,
      price: d.price?.value ?? null,
      currency: d.price?.currencyCode ?? "EUR",
    })).filter(d => d.price !== null);

    const inbound = (data.inbound || []).map(d => ({
      date: d.departureDate,
      price: d.price?.value ?? null,
      currency: d.price?.currencyCode ?? "EUR",
    })).filter(d => d.price !== null);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ outbound, inbound, from, to, month }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
