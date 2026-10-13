// ccp-market: what software the market asks for, per field and experience band.
//   GET  ?field=civil&years=3        -> rows from market_skills (any signed-in candidate)
//   POST { field, years_band? }       -> refresh: sample recent job descriptions for the field from
//                                       the ATS feeds + stored jobs, ask Claude to extract the tools,
//                                       upsert market_skills. Called weekly by a schedule (with the
//                                       CCP_CRON_SECRET header) or by a candidate with access.
import { createClient, createAdminClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CCP-Secret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const BANDS = ["0-2", "2-5", "5-10", "10+"];
const bandFor = (years: number) => (years < 2 ? "0-2" : years < 5 ? "2-5" : years < 10 ? "5-10" : "10+");
const strip = (html: string) => (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, " ").replace(/\s+/g, " ").trim();

async function get(url: string, init: RequestInit = {}, ms = 12000): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; CCP-Extension/2.0)", ...(init.headers || {}) } }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
}

async function sampleDescriptions(admin: any, field: string): Promise<Array<{ title: string; text: string }>> {
  const out: Array<{ title: string; text: string }> = [];
  const { data: jobs } = await admin.database.from("jobs").select("title, description").order("found_at", { ascending: false }).limit(400);
  for (const j of jobs || []) if ((j.description || "").length > 400) out.push({ title: j.title, text: j.description.slice(0, 3000) });
  const { data: companies } = await admin.database.from("companies").select("ats, token, name, fields").eq("active", true).limit(100);
  for (const c of (companies || []).filter((c: any) => (c.fields || []).some((f: string) => field.startsWith(f) || f.startsWith(field))).slice(0, 12)) {
    if (c.ats === "greenhouse") { const d = await get(`https://boards-api.greenhouse.io/v1/boards/${c.token}/jobs?content=true`); for (const j of (d?.jobs || []).slice(0, 15)) out.push({ title: j.title, text: strip(j.content).slice(0, 3000) }); }
    else if (c.ats === "lever") { const d = await get(`https://api.lever.co/v0/postings/${c.token}?mode=json`); for (const j of (Array.isArray(d) ? d : []).slice(0, 15)) out.push({ title: j.text, text: (j.descriptionPlain || "").slice(0, 3000) }); }
    else if (c.ats === "ashby") { const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${c.token}`); for (const j of (d?.jobs || []).slice(0, 15)) out.push({ title: j.title, text: (j.descriptionPlain || "").slice(0, 3000) }); }
  }
  return out.slice(0, 120);
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["bands"], properties: { bands: { type: "array", items: { type: "object", additionalProperties: false, required: ["years_band", "software"], properties: { years_band: { type: "string", enum: BANDS }, software: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "demand"], properties: { name: { type: "string" }, demand: { type: "integer" } } } } } } } } };

async function claude(system: string, user: string) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const model = Deno.env.get("CCP_MODEL") || "claude-opus-5-5";
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" };
  const messages = [{ role: "user", content: user }];
  let res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 8000, system, messages, fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } } }) });
  if (res.status === 400) { const t = await res.text(); if (/output_config|format|fallbacks|json_schema|effort|anthropic-beta/i.test(t)) { delete headers["anthropic-beta"]; res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 8000, system: `${system}\n\nRespond with a single JSON object only.`, messages }) }); } else throw new Error(`AI error 400: ${t.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  return { json: JSON.parse(text.slice(a, b + 1)), usage: data.usage || {}, model: data.model || model };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const base = Deno.env.get("INSFORGE_BASE_URL")!;
  const admin = createAdminClient({ baseUrl: base, apiKey: Deno.env.get("API_KEY")! });
  const cron = req.headers.get("X-CCP-Secret");
  const cronOk = !!cron && cron === (Deno.env.get("CCP_CRON_SECRET") || "");
  let userId: string | null = null;
  let access = false;
  if (!cronOk) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in first." }, 401);
    const client = createClient({ baseUrl: base, accessToken: token });
    const { data: u } = await client.auth.getCurrentUser();
    userId = u?.user?.id || null;
    if (!userId) return json({ error: "Session expired. Sign in again." }, 401);
    const { data: c } = await client.database.from("candidates").select("access_ok").eq("id", userId).limit(1);
    access = !!c?.[0]?.access_ok;
  }
  const url = new URL(req.url);

  if (req.method === "GET") {
    const field = url.searchParams.get("field") || "";
    const years = url.searchParams.get("years");
    let q = admin.database.from("market_skills").select("field, years_band, software, demand, sources, updated_at").order("demand", { ascending: false }).limit(300);
    if (field) q = q.eq("field", field);
    if (years) q = q.eq("years_band", bandFor(+years));
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ rows: data || [], bands: BANDS });
  }

  if (!cronOk && !access) return json({ error: "Market refresh needs an active CCP access code." }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const fields: string[] = body.field ? [String(body.field)] : ["civil", "it-infra", "security", "devops", "dev", "data", "it-support", "pm"];
  const report: any[] = [];
  for (const field of fields) {
    const samples = await sampleDescriptions(admin, field);
    if (samples.length < 5) { report.push({ field, skipped: `only ${samples.length} job descriptions` }); continue; }
    const system = `You analyse job descriptions for one professional field and list the software, tools, platforms and certifications employers ask for, separated by the experience band the posting targets (0-2, 2-5, 5-10, 10+ years). demand = how many of the given postings in that band mention it. Use canonical product names (e.g. "AutoCAD Civil 3D", "Bluebeam Revu", "Microsoft Intune"). Return at most 25 items per band, JSON only.`;
    const user = `FIELD: ${field}\n\nPOSTINGS (${samples.length}):\n${samples.map((s, i) => `--- #${i + 1} ${s.title}\n${s.text}`).join("\n")}`;
    try {
      const r = await claude(system, user);
      const rows: any[] = [];
      for (const b of r.json.bands || []) for (const s of b.software || []) rows.push({ field, years_band: b.years_band, software: s.name.trim(), demand: s.demand, sources: samples.length, updated_at: new Date().toISOString() });
      for (const row of rows) {
        const { data: ex } = await admin.database.from("market_skills").select("id").eq("field", field).eq("years_band", row.years_band).eq("software", row.software).limit(1);
        if (ex?.length) await admin.database.from("market_skills").update(row).eq("id", ex[0].id);
        else await admin.database.from("market_skills").insert([row]);
      }
      await admin.database.from("ai_calls").insert([{ candidate_id: userId, kind: "market", model: r.model, input_tokens: r.usage.input_tokens || 0, output_tokens: r.usage.output_tokens || 0, cost_usd: ((r.usage.input_tokens || 0) * 4 + (r.usage.output_tokens || 0) * 20) / 1e6 }]);
      report.push({ field, postings: samples.length, rows: rows.length });
    } catch (e) {
      report.push({ field, error: (e as Error).message });
    }
  }
  return json({ report });
}
