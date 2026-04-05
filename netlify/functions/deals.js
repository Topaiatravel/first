// deals.js — Netlify Function (GET)
// Legge il snapshot offerte da Netlify Blobs e lo serve al frontend
// Con cache CDN 1 ora per non fare fetch a ogni page load

const { getStore } = require("@netlify/blobs");

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
};

// Offerte di fallback per il primo deploy (prima che il cron giri)
const FALLBACK_DEALS = {
  deals: [],
  generatedAt: null,
  count: 0,
  isFallback: true,
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }

  try {
    const store = getStore("topaia-deals");
    const snapshot = await store.get("deals_snapshot", { type: "json" });

    if (!snapshot || !snapshot.deals?.length) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify(FALLBACK_DEALS),
      };
    }

    // Aggiungi info su freschezza dati
    const ageMs = Date.now() - new Date(snapshot.generatedAt).getTime();
    const ageHours = Math.round(ageMs / (1000 * 3600));
    const isStale = ageMs > 14 * 3600 * 1000; // oltre 14h → segnala

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ...snapshot,
        ageHours,
        isStale,
      }),
    };
  } catch (e) {
    // Blobs non disponibile (primo deploy o errore) → fallback
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ...FALLBACK_DEALS, error: e.message }),
    };
  }
};
