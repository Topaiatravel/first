// rate-check.js — Netlify Function
// Gestisce i tier Free / Registrato / Premium
// Chiamata prima di ogni ricerca con header opzionale di autenticazione
//
// Tier:
//   free      → 1 ricerca/giorno per IP
//   registered → 3 ricerche/giorno (token utente nel header)
//   premium   → 30 ricerche/giorno (token utente nel header)
//
// Per ora i token sono gestiti lato client (localStorage).
// In futuro: validazione server-side con DB (Supabase / Netlify Identity).

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-User-Token, X-User-Tier",
};

const TIERS = {
  free:       { dailyLimit: 100,  hourlyLimit: 20,  burstLimit: 30  },
  registered: { dailyLimit: 100,  hourlyLimit: 20,  burstLimit: 30  },
  premium:    { dailyLimit: 300, hourlyLimit: 30, burstLimit: 50 },
};

// In-memory store (si azzera ogni cold start Netlify, ~15 min inattività)
// Per persistenza reale usare Netlify Blobs o Supabase
const store = {};

function hashIp(ip) {
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = Math.imul(31, h) + ip.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// Validazione token semplice (HMAC-lite, da sostituire con JWT in produzione)
// Per ora: token = base64(tier:userId:day) — abbastanza per MVP
function validateToken(token) {
  if (!token) return { tier: "free", userId: null };
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length < 2) return { tier: "free", userId: null };
    const [tier, userId] = parts;
    if (!TIERS[tier]) return { tier: "free", userId: null };
    // TODO: validare firma crittografica quando si aggiunge un vero auth
    return { tier, userId };
  } catch {
    return { tier: "free", userId: null };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }

  const ip = event.headers["x-nf-client-connection-ip"]
    || event.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";

  const token = event.headers["x-user-token"] || "";
  const { tier, userId } = validateToken(token);
  const limits = TIERS[tier];

  // Chiave store: userId se autenticato, altrimenti hash IP
  const key = userId ? `u_${userId}` : `ip_${hashIp(ip)}`;
  const ts = nowSec();

  let s = store[key] || {
    hourStart: ts, hourCount: 0,
    dayStart:  ts, dayCount: 0,
    burstTimes: [], blockedUntil: 0,
  };

  // Blocco burst attivo?
  if (s.blockedUntil > ts) {
    const resetIn = s.blockedUntil - ts;
    return res(429, {
      allowed: false, tier,
      reason: "burst",
      resetIn,
      message: `Troppo veloce. Attendi ${Math.ceil(resetIn/60)} minuti.`,
    });
  }

  // Reset finestre temporali
  if (ts - s.hourStart >= 3600) { s.hourStart = ts; s.hourCount = 0; }
  if (ts - s.dayStart  >= 86400){ s.dayStart  = ts; s.dayCount  = 0; }

  // Pulizia burst window (60 secondi)
  s.burstTimes = s.burstTimes.filter(t => ts - t < 60);

  // Rilevamento burst
  if (s.burstTimes.length >= limits.burstLimit) {
    s.blockedUntil = ts + 600;
    store[key] = s;
    return res(429, {
      allowed: false, tier,
      reason: "burst_detected",
      resetIn: 600,
      message: "Comportamento anomalo. Accesso bloccato 10 minuti.",
    });
  }

  // Limite giornaliero
  if (s.dayCount >= limits.dailyLimit) {
    const resetIn = 86400 - (ts - s.dayStart);
    return res(429, {
      allowed: false, tier,
      reason: "daily",
      resetIn,
      remaining: 0,
      dailyLimit: limits.dailyLimit,
      message: tierLimitMessage(tier, limits.dailyLimit, resetIn),
    });
  }

  // Limite orario
  if (s.hourCount >= limits.hourlyLimit) {
    const resetIn = 3600 - (ts - s.hourStart);
    return res(429, {
      allowed: false, tier,
      reason: "hourly",
      resetIn,
      remaining: 0,
      message: `Limite orario raggiunto. Riprova tra ${Math.ceil(resetIn/60)} min.`,
    });
  }

  // OK — incrementa
  s.hourCount++;
  s.dayCount++;
  s.burstTimes.push(ts);
  store[key] = s;

  return res(200, {
    allowed: true,
    tier,
    remainingDay:  limits.dailyLimit  - s.dayCount,
    remainingHour: limits.hourlyLimit - s.hourCount,
    dailyLimit:    limits.dailyLimit,
  });
};

function tierLimitMessage(tier, limit, resetIn) {
  const hours = Math.ceil(resetIn / 3600);
  if (tier === "free") {
    return `Hai usato le tue ricerche gratuite di oggi. Registrati gratis per passsare a 10 ricerche/giorno gratuite, o passa a Premium per 30.`;
  }
  if (tier === "registered") {
    return `Hai usato le tue 10 ricerche di oggi. Passa a Premium (€5/anno) per 30 ricerche/giorno.`;
  }
  return `Limite giornaliero raggiunto. Riprova tra ${hours} ore.`;
}

function res(status, body) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) };
}
