# topaia.travel

Budget travel platform — "parti dal prezzo, scopri la destinazione"
Target: famiglie con nazionalità miste (es. IT + AM), viaggiatori flessibili.

---

## Deploy su Netlify da GitHub

### 1. Crea repo GitHub
Carica questa cartella su GitHub (drag & drop su github.com → New repository).

### 2. Collega a Netlify
- Netlify → **Add new site → Import from Git**
- Seleziona il repo
- **Build command:** *(lascia vuoto)*
- **Publish directory:** `.`
- Clicca **Deploy site**

### 3. ⚠️ Variabili d'ambiente (OBBLIGATORIO prima di andare live)

Vai su **Netlify → Site settings → Environment variables** e aggiungi:

| Variabile | Valore | Note |
|-----------|--------|------|
| `SERPAPI_KEY` | la-tua-key | Rigenera su serpapi.com — quella vecchia è esposta |

### 4. Dominio custom
- Compra `topaia.travel` su Cloudflare Registrar (~$30/anno)
- Netlify → **Domain management → Add custom domain**
- Segui le istruzioni per il DNS (Netlify gestisce SSL automatico)

---

## Struttura file

```
topaia/
├── index.html                    # Frontend completo (React via CDN, no build)
├── netlify.toml                  # Routing + config Netlify
└── netlify/functions/
    ├── package.json              # @netlify/functions + @netlify/blobs
    ├── search.js                 # Proxy SerpApi/Google Flights
    ├── ryanair.js                # Ryanair cheapestPerDay
    ├── wizzair.js                # Wizz Air timetable
    ├── aviasales.js              # Aviasales + special_offers
    ├── hotels.js                 # Hotellook hotel search
    ├── rate-check.js             # Tier Free/Account/Premium
    ├── fetch-deals.js            # CRON 12h — salva offerte in Blobs
    └── deals.js                  # Serve snapshot offerte al frontend
```

---

## Prossimi passi post-deploy

- [ ] Rigenerare SerpApi key e salvarla in env variable
- [ ] Verificare che le 7 Netlify Functions rispondano su `/api/*`
- [ ] Test ricerca da Roma → Yerevan (rotta IT+AM principale)
- [ ] Collegare dominio topaia.travel
- [ ] Setup LemonSqueezy per pagamenti Premium (€5/anno)
- [ ] Richiedere approvazione Booking.com Affiliate
