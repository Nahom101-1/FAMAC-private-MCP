// Liten klient for FAMAC API v2
export interface Env {
  FAMAC_BASE: string;   // https://api.famacweb.no/api/v2/
  FAMAC_TOKEN: string;  // hemmelighet: token fra FDVhuset
  MCP_KEY: string;      // hemmelighet: nøkkel som beskytter MCP-serveren
  SNAPSHOTS: KVNamespace;
}

type Params = Record<string, string | number | unknown[] | undefined>;

function buildUrl(env: Env, path: string, params: Params = {}): URL {
  const url = new URL(path, env.FAMAC_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
  }
  return url;
}

async function call(env: Env, url: URL, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.FAMAC_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Famac svarte ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export const famacGet = (env: Env, path: string, params?: Params) =>
  call(env, buildUrl(env, path, params));

export const famacPost = (env: Env, path: string, body: unknown, params?: Params) =>
  call(env, buildUrl(env, path, params), { method: "POST", body: JSON.stringify(body) });

/** Henter alle sider (maks maxPages, fordi gratisplanen tillater 50 kall per kjøring). */
export async function famacAll(
  env: Env,
  path: string,
  params: Params = {},
  maxPages = 20,
  pageSize = 100,
  post?: unknown,
): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const p = { ...params, page, page_size: pageSize };
    const res = post === undefined ? await famacGet(env, path, p) : await famacPost(env, path, post, p);
    const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
    out.push(...rows);
    // Stopp når det ikke finnes flere sider
    if (rows.length < pageSize || (!Array.isArray(res) && !res?.links?.next)) break;
  }
  return out;
}

// --- Trimming: bare feltene vi trenger, så svarene blir små ---

export const frist = (a: any): string | null => a.due_date ?? a.start_date ?? null;

export const trimActivity = (a: any) => ({
  id: a.id,
  nr: a.act_id,
  navn: a.name,
  prioritet: a.priority,
  frist: frist(a),
  start: a.start_date,
  gjentas: a.repeat || null,
  status: a.activity_status,
  bygg: a.building?.name ?? a.building_id,
  bygg_id: a.building_id,
  kategori: a.category?.name ?? null,
  ansvarlig: a.responsible?.name ?? null,
  utforer: a.executor?.name ?? null,
  fra_avvik: a.activity_created_from_deviation_id ?? null,
  oppdatert: a.updated_at,
});

export const trimSignout = (s: any) => ({
  id: s.id,
  aktivitet_id: s.activity_id,
  nr: s.act_id,
  navn: s.name,
  frist: s.scheduled_date,
  utfort: s.executed_on_date,
  signert_ut: s.signed_out_at,
  innen_frist: s.scheduled_date && s.executed_on_date ? s.executed_on_date <= s.scheduled_date : null,
  status: s.status,
  bygg_id: s.building_id,
  kommentar: s.signout_comment || null,
});

export const trimDeviation = (d: any) => ({
  id: d.id,
  status: d.status,
  type: d.type,
  beskrivelse: d.description,
  tiltak: d.proposed_course_of_action,
  rapportert: d.reported_at,
  sist_endret_status: d.last_status_update_at,
  bygg: d.building?.name ?? d.building_id,
  bygg_id: d.building_id,
  system: d.system?.name ?? null,
  rom: d.room?.name ?? null,
  melder: d.reporter?.name ?? null,
});