import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  type Env, famacAll,
  trimActivity, trimSignout, trimDeviation,
} from "./famac";
import { takeSnapshot, getChanges } from "./snapshot";

const dato = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Dato på formen ÅÅÅÅ-MM-DD");
const svar = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const iDag = () => new Date().toISOString().slice(0, 10);
const plussDager = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

async function aktiviteter(env: Env, byggId?: string, maxSider = 30) {
  const path = byggId ? `activities/building/${byggId}` : "activities";
  return (await famacAll(env, path, { with: ["building", "category", "users"] }, maxSider)).map(trimActivity);
}

async function avvik(env: Env, body: Record<string, unknown>, maxSider = 20) {
  return (await famacAll(env, "deviations/search", { with: ["building", "system", "room", "reporter"] }, maxSider, 100, body))
    .map(trimDeviation);
}

function createServer(env: Env) {
  const server = new McpServer({ name: "famac", version: "1.0.0" });

  server.registerTool("hent_bygg", {
    description: "Lister alle bygg i Famac med id, kode, navn, byggruppe og driftsledere.",
    inputSchema: z.object({}),
  }, async () => {
    const bygg = await famacAll(env, "buildings", { with: ["details"] }, 10);
    return svar(bygg.map((b: any) => ({
      id: b.id, kode: b.code, navn: b.name,
      byggruppe: b.details?.group ? `${b.details.group.group_code} ${b.details.group.name}` : null,
      driftsledere: (b.details?.managers ?? []).map((m: any) => m.name),
    })));
  });

  server.registerTool("hent_aktiviteter", {
    description: "Henter aktive aktiviteter (arbeidsordre), eventuelt for ett bygg. Filtrer på frist med fra/til.",
    inputSchema: z.object({
      bygg_id: z.string().optional().describe("Bygg-id fra hent_bygg"),
      frist_fra: dato.optional(),
      frist_til: dato.optional(),
    }),
  }, async ({ bygg_id, frist_fra, frist_til }) => {
    const rows = (await aktiviteter(env, bygg_id)).filter((a) =>
      a.status === "active" &&
      (!frist_fra || (a.frist && a.frist >= frist_fra)) &&
      (!frist_til || (a.frist && a.frist <= frist_til)));
    return svar(rows);
  });

  server.registerTool("hent_fullforte", {
    description: "Henter fullførte (signert ut) aktiviteter siden en dato, med om de ble gjort innen frist.",
    inputSchema: z.object({ siden: dato, bygg_id: z.string().optional() }),
  }, async ({ siden, bygg_id }) => {
    const rows = (await famacAll(env, "activity-signouts", { updated_since: siden }, 30))
      .map(trimSignout)
      .filter((s) => (!bygg_id || s.bygg_id === bygg_id) && (s.utfort ?? "") >= siden);
    return svar(rows);
  });

  server.registerTool("sok_avvik", {
    description: "Søker i avvik. Filtrer på bygg og når avviket ble opprettet eller sist endret.",
    inputSchema: z.object({
      bygg_ids: z.array(z.string()).optional(),
      opprettet_fra: dato.optional(), opprettet_til: dato.optional(),
      endret_fra: dato.optional(), endret_til: dato.optional(),
    }),
  }, async (a) => svar(await avvik(env, {
    building_ids: a.bygg_ids, created_at_from: a.opprettet_fra, created_at_to: a.opprettet_til,
    updated_at_from: a.endret_fra, updated_at_to: a.endret_til,
  })));

  server.registerTool("hent_fristendringer", {
    description: "Frister som er endret i en periode, fra de daglige øyeblikksbildene. 'gjentakende: true' kan være ny forekomst.",
    inputSchema: z.object({ fra: dato, til: dato }),
  }, async ({ fra, til }) => svar(await getChanges(env, fra, til)));

  server.registerTool("rapport_driftsmote", {
    description: "Samlet grunnlag for driftsmøtet: fullført, forfalt, utsatte frister, kommende, nye/lukkede avvik og gamle ubehandlede avvik.",
    inputSchema: z.object({
      bygg_ids: z.array(z.string()).optional().describe("Tom = alle bygg"),
      periode_dager: z.number().int().min(1).max(90).default(14),
      ubehandlet_dager: z.number().int().min(1).max(365).default(14),
    }),
  }, async ({ bygg_ids, periode_dager, ubehandlet_dager }) => {
    const til = iDag(), fra = plussDager(til, -periode_dager), framover = plussDager(til, periode_dager);
    const iBygg = (id: string | null | undefined) => !bygg_ids?.length || (id != null && bygg_ids.includes(id));

    const [akt, fullf, endr, alleAvvik] = await Promise.all([
      aktiviteter(env, undefined, 20),
      famacAll(env, "activity-signouts", { updated_since: fra }, 10).then((r) => r.map(trimSignout)),
      getChanges(env, fra, til),
      avvik(env, { building_ids: bygg_ids?.length ? bygg_ids : undefined }, 15),
    ]);

    const aktive = akt.filter((a) => a.status === "active" && iBygg(a.bygg_id));
    const fullfort = fullf.filter((s) => iBygg(s.bygg_id) && (s.utfort ?? "") >= fra);
    const ubehandletGrense = plussDager(til, -ubehandlet_dager);

    return svar({
      periode: { fra, til, framover_til: framover },
      fullfort_i_perioden: fullfort,
      andel_innen_frist: fullfort.length
        ? Math.round((100 * fullfort.filter((s) => s.innen_frist).length) / fullfort.length) : null,
      forfalt_ikke_fullfort: aktive.filter((a) => a.frist && a.frist < til),
      frister_endret: endr,
      kommende: aktive.filter((a) => a.frist && a.frist >= til && a.frist <= framover),
      avvik_nye: alleAvvik.filter((d) => (d.rapportert ?? "") >= fra),
      avvik_lukket: alleAvvik.filter((d) => d.status !== "unhandled" && (d.sist_endret_status ?? "") >= fra),
      avvik_ubehandlet_lenge: alleAvvik.filter((d) => d.status === "unhandled" && (d.rapportert ?? "9") < ubehandletGrense),
      merknad: "Statusverdier for lukkede avvik er ikke dokumentert av Famac. Kontroller mot ekte data.",
    });
  });

  return server;
}

// Sammenligner nøkler i konstant tid (beskytter mot gjetting)
function sameKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
     // Stopp tydelig hvis hemmelighetene mangler (f.eks. ingen .dev.vars lokalt)
    if (!env.MCP_KEY || !env.FAMAC_TOKEN) {
      return new Response("Serveren mangler MCP_KEY eller FAMAC_TOKEN. Se Steg 3 i guiden.", { status: 500 });
    }

    // Nøkkelen kan komme i adressen (/<MCP_KEY>/mcp) eller i headeren x-api-key (/mcp)
    const [, pathKey, rest] = url.pathname.split("/");
    const pathOk = Boolean(pathKey) && sameKey(pathKey, env.MCP_KEY);
    const headerKey = request.headers.get("x-api-key");
    const headerOk = url.pathname === "/mcp" && headerKey !== null && sameKey(headerKey, env.MCP_KEY);

    // Manuell test av øyeblikksbildet: åpne /<MCP_KEY>/snapshot i nettleseren
    if (pathOk && rest === "snapshot") return Response.json(await takeSnapshot(env));

    if (!(pathOk && rest === "mcp") && !headerOk) return new Response("Ikke tilgang", { status: 401 });
    const mcpRequest = pathOk ? new Request(new URL("/mcp" + url.search, url), request) : request;
    return createMcpHandler(() => createServer(env))(mcpRequest, env, ctx);
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(takeSnapshot(env).then((r) => console.log("Øyeblikksbilde", r)));
  },
};