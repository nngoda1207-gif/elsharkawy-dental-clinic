import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PIN_HASH = "18c1616e3e33c3a17d772899f6351171607e49f96a31f9ae7415fd7f5d99fb97";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const attempts = new Map<string, { n: number; start: number }>();
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const obj = (v: any) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function mergeValue(base: any, local: any, remote: any): any {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)) {
    const allHaveIds = [...base, ...local, ...remote].every(x => x && typeof x === "object" && x.id != null);
    if (allHaveIds) return mergeCollection(base, local, remote, "id");
    return [...new Set([...remote, ...local])];
  }
  if (!Array.isArray(local) && !Array.isArray(remote) && typeof local === "object" && local && typeof remote === "object" && remote) {
    const b = obj(base), l = obj(local), r = obj(remote), out: any = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      const v = mergeValue(b[k], l[k], r[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  const lt = Number(local?.u || local?.t || 0), rt = Number(remote?.u || remote?.t || 0);
  return lt > rt ? local : remote;
}
function mergeCollection(base: any[], local: any[], remote: any[], key: string, fallback?: (x: any) => string) {
  const getKey = (x: any) => String(fallback ? fallback(x) : x?.[key] ?? "undefined");
  const B = new Map((base || []).map(x => [getKey(x), x]));
  const L = new Map((local || []).map(x => [getKey(x), x]));
  const R = new Map((remote || []).map(x => [getKey(x), x]));
  const ids = new Set([...B.keys(), ...L.keys(), ...R.keys()]);
  const out: any[] = [];
  for (const id of ids) {
    const v = mergeValue(B.get(id), L.get(id), R.get(id));
    if (v != null) out.push(v);
  }
  return out;
}
function mergeState(base: any, local: any, remote: any) {
  const b = obj(base), l = obj(local), r = obj(remote), out: any = { ...r };
  for (const k of ["visits", "pays"]) out[k] = mergeCollection(b[k] || [], l[k] || [], r[k] || [], "id");
  const catKey = (x: any) => String(x?.name || "").trim().toLocaleLowerCase();
  const itemKey = (x: any) => [String(x?.n || "").trim().toLocaleLowerCase(), String(x?.u || "").trim().toLocaleLowerCase()].join("|");
  const cats = mergeCollection(b.cats || [], l.cats || [], r.cats || [], "id", catKey);
  out.cats = cats.map((c: any) => {
    const matchCat = (arr: any[]) => arr.find((x: any) => x.id === c.id) || arr.find((x: any) => catKey(x) === catKey(c)) || {};
    const bc = matchCat(b.cats || []), lc = matchCat(l.cats || []), rc = matchCat(r.cats || []);
    return { ...c, items: mergeCollection(bc.items || [], lc.items || [], rc.items || [], "id", itemKey) };
  });
  out.prof = mergeValue(b.prof || {}, l.prof || {}, r.prof || {});
  const deviceOnly = new Set(["cart", "drafts", "nt", "seen", "kashf", "undo"]);
  for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (deviceOnly.has(k)) delete out[k];
    else {
      const v = mergeValue(b[k], l[k], r[k]);
      if (v !== undefined) out[k] = v;
      else delete out[k];
    }
  }
  return out;
}
async function readCurrent() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clinic_sync_state?id=eq.main&select=data,updated_at`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error("تعذر قراءة بيانات العيادة");
  const rows = await res.json();
  return rows?.[0] || null;
}
async function saveWithCompareAndSwap(expected: string | null, data: any) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json", Prefer: "return=representation",
  };
  if (expected === null) {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/clinic_sync_state`, {
      method: "POST", headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ id: "main", data, updated_at: new Date().toISOString() }),
    });
    if (!ins.ok) throw new Error("تعذر إنشاء سجل مزامنة العيادة");
    return (await ins.json()).length > 0;
  }
  const url = `${SUPABASE_URL}/rest/v1/clinic_sync_state?id=eq.main&updated_at=eq.${encodeURIComponent(expected)}`;
  const upd = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) });
  if (!upd.ok) throw new Error("تعذر حفظ بيانات العيادة");
  return (await upd.json()).length > 0;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now(), a = attempts.get(ip) || { n: 0, start: now };
  if (now - a.start > 15 * 60 * 1000) { a.n = 0; a.start = now; }
  if (a.n >= 10) return new Response(JSON.stringify({ error: "محاولات كثيرة، حاولي بعد 15 دقيقة" }), { status: 429, headers: cors });
  try {
    const body = await req.json();
    if (await sha(String(body.pin || "") + "-elsharkawy-clinic-sync-v1") !== PIN_HASH) {
      a.n++; attempts.set(ip, a);
      return new Response(JSON.stringify({ error: "رمز المزامنة غير صحيح" }), { status: 401, headers: cors });
    }
    a.n = 0; attempts.set(ip, a);
    if (body.action !== "sync") return new Response(JSON.stringify({ error: "action invalid" }), { status: 400, headers: cors });
    const local = obj(body.data?.state), base = obj(body.data?.base);
    let merged: any = local;
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await readCurrent();
      merged = row ? mergeState(base, local, row.data) : local;
      if (await saveWithCompareAndSwap(row?.updated_at ?? null, merged)) {
        return new Response(JSON.stringify({ ok: true, state: merged, server_time: Date.now() }), { headers: cors });
      }
    }
    return new Response(JSON.stringify({ error: "فيه تعديلات متزامنة كتير؛ حاولي المزامنة مرة تانية" }), { status: 409, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || "sync failed") }), { status: 500, headers: cors });
  }
});