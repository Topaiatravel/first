// Netlify Function: Aviasales Data API (Travelpayouts)
// Due modalità:
//   /api/aviasales?from=MXP&to=BCN&month=2026-06  → prezzi cached rotta specifica
//   /api/aviasales?from=MXP&mode=special            → offerte anomale/flash da qualsiasi dest

const AVIASALES_TOKEN = "29e331be9373b8ccd6c7d6eb47082305";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const DEST_INFO = {
  BCN:{city:"Barcellona",country:"Spagna",flag:"🇪🇸"},
  MAD:{city:"Madrid",country:"Spagna",flag:"🇪🇸"},
  LIS:{city:"Lisbona",country:"Portogallo",flag:"🇵🇹"},
  OPO:{city:"Porto",country:"Portogallo",flag:"🇵🇹"},
  ATH:{city:"Atene",country:"Grecia",flag:"🇬🇷"},
  BUD:{city:"Budapest",country:"Ungheria",flag:"🇭🇺"},
  PRG:{city:"Praga",country:"Rep. Ceca",flag:"🇨🇿"},
  WAW:{city:"Varsavia",country:"Polonia",flag:"🇵🇱"},
  KRK:{city:"Cracovia",country:"Polonia",flag:"🇵🇱"},
  VIE:{city:"Vienna",country:"Austria",flag:"🇦🇹"},
  AMS:{city:"Amsterdam",country:"Olanda",flag:"🇳🇱"},
  DUB:{city:"Dublino",country:"Irlanda",flag:"🇮🇪"},
  EDI:{city:"Edimburgo",country:"UK",flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿"},
  STN:{city:"Londra Stansted",country:"UK",flag:"🇬🇧"},
  LGW:{city:"Londra Gatwick",country:"UK",flag:"🇬🇧"},
  LHR:{city:"Londra Heathrow",country:"UK",flag:"🇬🇧"},
  CMN:{city:"Casablanca",country:"Marocco",flag:"🇲🇦"},
  RAK:{city:"Marrakech",country:"Marocco",flag:"🇲🇦"},
  IST:{city:"Istanbul",country:"Turchia",flag:"🇹🇷"},
  DXB:{city:"Dubai",country:"EAU",flag:"🇦🇪"},
  DOH:{city:"Doha",country:"Qatar",flag:"🇶🇦"},
  AUH:{city:"Abu Dhabi",country:"EAU",flag:"🇦🇪"},
  CAI:{city:"Il Cairo",country:"Egitto",flag:"🇪🇬"},
  SOF:{city:"Sofia",country:"Bulgaria",flag:"🇧🇬"},
  OTP:{city:"Bucarest",country:"Romania",flag:"🇷🇴"},
  SKP:{city:"Skopje",country:"Macedonia",flag:"🇲🇰"},
  TIA:{city:"Tirana",country:"Albania",flag:"🇦🇱"},
  TGD:{city:"Podgorica",country:"Montenegro",flag:"🇲🇪"},
  LCA:{city:"Larnaca",country:"Cipro",flag:"🇨🇾"},
  NBO:{city:"Nairobi",country:"Kenya",flag:"🇰🇪"},
  ADD:{city:"Addis Abeba",country:"Etiopia",flag:"🇪🇹"},
  JNB:{city:"Johannesburg",country:"Sud Africa",flag:"🇿🇦"},
  LOS:{city:"Lagos",country:"Nigeria",flag:"🇳🇬"},
  BOM:{city:"Mumbai",country:"India",flag:"🇮🇳"},
  DEL:{city:"Delhi",country:"India",flag:"🇮🇳"},
  GRU:{city:"São Paulo",country:"Brasile",flag:"🇧🇷"},
  RIX:{city:"Riga",country:"Lettonia",flag:"🇱🇻"},
  TLL:{city:"Tallinn",country:"Estonia",flag:"🇪🇪"},
  HEL:{city:"Helsinki",country:"Finlandia",flag:"🇫🇮"},
  CPH:{city:"Copenaghen",country:"Danimarca",flag:"🇩🇰"},
  BRU:{city:"Bruxelles",country:"Belgio",flag:"🇧🇪"},
  MRS:{city:"Marsiglia",country:"Francia",flag:"🇫🇷"},
  NCE:{city:"Nizza",country:"Francia",flag:"🇫🇷"},
  PMI:{city:"Palma Maiorca",country:"Spagna",flag:"🇪🇸"},
  IBZ:{city:"Ibiza",country:"Spagna",flag:"🇪🇸"},
  AGP:{city:"Malaga",country:"Spagna",flag:"🇪🇸"},
  RHO:{city:"Rodi",country:"Grecia",flag:"🇬🇷"},
  HER:{city:"Heraklion",country:"Grecia",flag:"🇬🇷"},
  CFU:{city:"Corfù",country:"Grecia",flag:"🇬🇷"},
  ZTH:{city:"Zante",country:"Grecia",flag:"🇬🇷"},
  SKG:{city:"Salonicco",country:"Grecia",flag:"🇬🇷"},
  TLV:{city:"Tel Aviv",country:"Israele",flag:"🇮🇱"},
  AMM:{city:"Amman",country:"Giordania",flag:"🇯🇴"},
  RUH:{city:"Riyadh",country:"Arabia S.",flag:"🇸🇦"},
  EVN:{city:"Yerevan",country:"Armenia",flag:"🇦🇲"},
  ZVN:{city:"Yerevan",country:"Armenia",flag:"🇦🇲"},
  CTA:{city:"Catania",country:"Italia",flag:"🇮🇹"},
  PSA:{city:"Pisa",country:"Italia",flag:"🇮🇹"},
  KWI:{city:"Kuwait City",country:"Kuwait",flag:"🇰🇼"},
};

const AIRLINE_NAMES = {
  FR:"Ryanair", W6:"Wizz Air", U2:"easyJet",
  VY:"Vueling", HV:"Transavia NL", TO:"Transavia FR",
  EW:"Eurowings", V7:"Volotea", IB:"Iberia",
  AZ:"ITA Airways", TK:"Turkish Airlines",
  EK:"Emirates", QR:"Qatar Airways", EY:"Etihad",
  ET:"Ethiopian Airlines", PC:"Pegasus",
  LH:"Lufthansa", BA:"British Airways", AF:"Air France",
  KL:"KLM", LX:"Swiss", OS:"Austrian",
  TP:"TAP Portugal", A3:"Aegean",
};

function enrichDest(code) {
  return DEST_INFO[code] || { city: code, country: "—", flag: "✈" };
}

function enrichAirline(code) {
  return AIRLINE_NAMES[code] || code;
}

// ── Handler principale ────────────────────────────────────────────────────────

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
  const { from, to, month, mode } = event.queryStringParameters || {};

  // Modalità offerte speciali: /api/aviasales?from=MXP&mode=special
  if (mode === "special") {
    return handleSpecialOffers(from);
  }

  // Modalità normale: /api/aviasales?from=MXP&to=BCN&month=2026-06
  if (!from || !to || !month) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Parametri mancanti: from, to, month" }),
    };
  }
  return handleCheap(from, to, month);
};

// ── Prezzi cached per rotta specifica ─────────────────────────────────────────
async function handleCheap(from, to, month) {
  const url = `https://api.travelpayouts.com/v1/prices/cheap` +
    `?origin=${from}&destination=${to}` +
    `&depart_date=${month}&return_date=${month}` +
    `&currency=eur&market=it&token=${AVIASALES_TOKEN}`;
  try {
    const res = await fetch(url, {
      headers: { "x-access-token": AVIASALES_TOKEN },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) return ok({ fares: [], noData: true, from, to });
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.success || !data.data) return ok({ fares: [], noData: true, from, to });

    const fares = [];
    const destData = data.data[to] || {};
    Object.values(destData).forEach(ticket => {
      if (!ticket.price || !ticket.departure_at) return;
      const destInfo = enrichDest(to);
      fares.push({
        depDate: ticket.departure_at.split("T")[0],
        retDate: ticket.return_at?.split("T")[0] || null,
        price: ticket.price,
        airline: enrichAirline(ticket.airline || "??"),
        airlineCode: ticket.airline || "??",
        flightNumber: ticket.flight_number || null,
        ...destInfo,
        destCode: to, from,
        link: ticket.link ? `https://www.aviasales.com/search/${ticket.link}` : null,
      });
    });
    fares.sort((a, b) => a.price - b.price);
    return ok({ fares, from, to, month });
  } catch (err) {
    return error(err.message);
  }
}

// ── Offerte anomale/flash da qualsiasi destinazione ───────────────────────────
// get_special_offers restituisce prezzi anomalmente bassi rispetto alla media storica
async function handleSpecialOffers(from) {
  if (!from) return error("Parametro 'from' mancante");

  const url = `https://api.travelpayouts.com/aviasales/v3/get_special_offers` +
    `?origin=${from}&currency=eur&locale=it&token=${AVIASALES_TOKEN}`;
  try {
    const res = await fetch(url, {
      headers: { "x-access-token": AVIASALES_TOKEN },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      if (res.status === 404) return ok({ offers: [], noData: true });
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.success || !data.data?.length) return ok({ offers: [], noData: true });

    // Normalizza — ogni offer ha: origin, destination, price, depart_date,
    // return_date, airline, number_of_changes, distance, show_to_affiliates
    const offers = data.data
      .filter(o => o.price && o.depart_date && o.destination)
      .map(o => {
        const destInfo = enrichDest(o.destination);
        const airlineName = enrichAirline(o.airline || "??");
        const nights = o.return_date && o.depart_date
          ? Math.round((new Date(o.return_date) - new Date(o.depart_date)) / (1000*60*60*24))
          : null;
        return {
          depDate: o.depart_date,
          retDate: o.return_date || null,
          price: o.price,
          airline: airlineName,
          airlineCode: o.airline || "??",
          stops: o.number_of_changes || 0,
          nights,
          isFlash: true, // badge offerta anomala
          ...destInfo,
          destCode: o.destination,
          from: o.origin || from,
          link: o.link ? `https://www.aviasales.com/search/${o.link}` : null,
        };
      })
      .sort((a, b) => a.price - b.price);

    return ok({ offers, from, count: offers.length });
  } catch (err) {
    return error(err.message);
  }
}

function ok(body) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
}
function error(msg) {
  return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: msg }) };
}
