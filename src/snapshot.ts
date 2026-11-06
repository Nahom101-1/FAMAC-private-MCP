// Daglig øyeblikksbilde av frister. Famac har ingen historikk, så vi lager den selv.
import { type Env, famacAll, frist } from "./famac";

type Snap = Record<string, { f: string | null; n: string; b: string; r: boolean }>;

export interface Fristendring {
  dato: string;          // dagen endringen ble oppdaget
  aktivitet_id: string;
  navn: string;
  bygg: string;
  gammel_frist: string;
  ny_frist: string;
  utsatt: boolean;       // true = fristen ble flyttet fram i tid
  gjentakende: boolean;  // true = kan være ny forekomst, ikke en reell utsettelse
}

export async function takeSnapshot(env: Env): Promise<{ aktive: number; endringer: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const acts = await famacAll(env, "activities", { with: ["building"] }, 40);

  const prev = (await env.SNAPSHOTS.get<Snap>("snapshot:latest", "json")) ?? {};
  const now: Snap = {};
  const changes: Fristendring[] = [];

  for (const a of acts) {
    if (a.activity_status !== "active") continue;
    const entry = { f: frist(a), n: a.name, b: a.building?.name ?? a.building_id, r: Boolean(a.repeat) };
    now[a.id] = entry;
    const old = prev[a.id];
    if (old?.f && entry.f && old.f !== entry.f) {
      changes.push({
        dato: today,
        aktivitet_id: a.id,
        navn: entry.n,
        bygg: entry.b,
        gammel_frist: old.f,
        ny_frist: entry.f,
        utsatt: entry.f > old.f,
        gjentakende: entry.r,
      });
    }
  }

  await env.SNAPSHOTS.put("snapshot:latest", JSON.stringify(now));
  if (changes.length) {
    const log = (await env.SNAPSHOTS.get<Fristendring[]>("fristendringer", "json")) ?? [];
    log.push(...changes);
    await env.SNAPSHOTS.put("fristendringer", JSON.stringify(log.slice(-20000)));
  }
  await env.SNAPSHOTS.put("snapshot:sist_kjort", today);
  return { aktive: Object.keys(now).length, endringer: changes.length };
}

export async function getChanges(env: Env, fra: string, til: string): Promise<Fristendring[]> {
  const log = (await env.SNAPSHOTS.get<Fristendring[]>("fristendringer", "json")) ?? [];
  return log.filter((c) => c.dato >= fra && c.dato <= til);
}