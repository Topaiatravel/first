// Netlify Function: proxy verso SerpApi
// Chiamato da /api/search?...params...
// Gira server-side → nessun problema CORS
//
// ⚠️  La key NON è hardcoded — legge da variabile d'ambiente Netlify:
//     SERPAPI_KEY  →  Site settings → Environment variables

// ── Rate limit guard (server-side, seconda linea di difesa) ──────────────
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

exports.handler = async (event) => {
  // Server-side rate limit: 20 req/min per IP
  const clientIp =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown";
  if (!serverRateCheck(clientIp, 20, 60)) {
    return {
      statusCode: 429,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Rate limit exceeded" }),
    };
  }

  // ✅ Key da variabile d'ambiente — mai nel codice
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "SERPAPI_KEY non configurata. Vai su Netlify → Site settings → Environment variables." }),
    };
  }

  const params = new URLSearchParams(event.queryStringParameters || {});
  params.set("api_key", SERPAPI_KEY);
  params.set("engine", "google_flights");

  try {
    const response = await fetch(`https://serpapi.com/search?${params}`);
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
