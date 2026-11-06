# FAMAC-private-MCP

En liten MCP-server som gir Claude lesetilgang til **Famac** (aktiviteter og avvik). Den kjører gratis på **Cloudflare Workers**.

Formålet er å lage rapporter til driftsmøtene: hva som er fullført, hva som har passert fristen, hvilke frister som er utsatt, hva som kommer de neste ukene, og status på avvik.

```
Claude  ──(MCP + nøkkel)──▶  Cloudflare Worker  ──(token, kun lesing)──▶  Famac API
                                   │
                                   └── KV: daglig øyeblikksbilde av frister
```

## Verktøy

| Verktøy | Gjør |
| --- | --- |
| `rapport_driftsmote` | Alt til driftsmøtet i ett kall |
| `hent_bygg` | Bygg med byggruppe og driftsledere |
| `hent_aktiviteter` | Aktive arbeidsordre, filtrert på bygg og frist |
| `hent_fullforte` | Signert ut siden en dato, med «innen frist» ja/nei |
| `sok_avvik` | Avvik filtrert på bygg og dato |
| `hent_fristendringer` | Utsatte og endrede frister fra de nattlige øyeblikksbildene |

Famac-API-et har ingen historikk for frister. Derfor tar Workeren et øyeblikksbilde hver natt kl. 03:00 UTC, lagrer det i KV og logger frister som er endret.

## Kom i gang

Du trenger Node.js 20 eller nyere, en Cloudflare-konto (gratisplanen holder) og et Famac-token fra FDVhuset.

```bash
npm install
npx wrangler login
```

Lag KV-lageret, og legg ID-en inn i `wrangler.jsonc` under `kv_namespaces`. Bindingen må hete `SNAPSHOTS`.

```bash
npx wrangler kv namespace create famac-snapshots
```

### Lokalt

Lag filen `.dev.vars`. Den holdes utenfor git.

```
FAMAC_TOKEN=<token fra FDVhuset>
MCP_KEY=<resultatet av: openssl rand -hex 32>
```

```bash
npm run dev
npx @modelcontextprotocol/inspector   # Streamable HTTP, autentisering: None
```

Bruk URL-en `http://localhost:8787/<MCP_KEY>/mcp`.

### Publiser

```bash
npx wrangler secret put FAMAC_TOKEN
npx wrangler secret put MCP_KEY
npm run deploy
```

Lag det første øyeblikksbildet ved å åpne `https://famac-mcp.<konto>.workers.dev/<MCP_KEY>/snapshot`.

### Koble til Claude

En eier av organisasjonen går til **Organization settings → Connectors → Add → Custom**. Bruk URL-en `https://famac-mcp.<konto>.workers.dev/<MCP_KEY>/mcp` og autentisering **No sign-in**. Hver bruker klikker deretter **Connect** under **Customize → Connectors**.

## Sikkerhet

- Be FDVhuset bare om **lese-scopes**: Get activities, Get activity signouts, Get deviations og Read Buildings.
- `FAMAC_TOKEN` og `MCP_KEY` lagres som hemmeligheter hos Cloudflare og skal **aldri** inn i git.
- Adressen med `MCP_KEY` er et passord. Lekker den, lager du en ny nøkkel og legger connectoren inn på nytt.

## Filer

| Fil | Innhold |
| --- | --- |
| `src/index.ts` | MCP-verktøyene, nøkkelsjekken og den nattlige jobben |
| `src/famac.ts` | Klient for Famac API v2, med sidevisning og trimming av svar |
| `src/snapshot.ts` | Øyeblikksbilder og logg over fristendringer |
| `wrangler.jsonc` | Cloudflare-konfigurasjon: KV, tidsplan og variabler |

## Kjent usikkerhet

- Famac dokumenterer bare avviksstatusen `unhandled`. Hvilke statuser som betyr «lukket», må bekreftes mot ekte data.
- Gjentakende aktiviteter kan få ny frist når de signeres ut. Slike endringer merkes med `gjentakende: true`.
- Gratisplanen gir 10 ms CPU-tid per forespørsel. Ved svært mange aktiviteter kan det bli nødvendig å hente per bygg, eller å bruke Workers Paid (5 USD i måneden).

## Lenker

- [FAMAC API v2](https://docs.famacweb.no/)
- [Cloudflare Agents – MCP handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [Claude – egendefinerte connectorer](https://claude.com/docs/connectors/custom)
