// ccp-research-jobs: find open roles for the signed-in candidate on employers' own career sites
// through the ATS public job feeds (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday).
// Matches title and location against the candidate's targets, scores, and stores them in `jobs`.
// POST { titles?, locations?, field?, limit?, companies?: [{ats, token, name}] , discover?: ["Company name", ...] }
import { createClient, createAdminClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const strip = (html: string) => (html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

type Found = { source: string; ats: string; company: string; title: string; location: string; url: string; apply_url: string; description: string; posted?: string };

async function get(url: string, init: RequestInit = {}, ms = 12000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { "accept": "application/json", "user-agent": "Mozilla/5.0 (compatible; CCP-Extension/2.0)", ...(init.headers || {}) } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

async function feed(ats: string, token: string, company: string, searchText: string): Promise<Found[]> {
  const out: Found[] = [];
  if (ats === "greenhouse") {
    const d = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
    for (const j of d?.jobs || []) out.push({ source: "ats", ats, company, title: j.title, location: j.location?.name || "", url: j.absolute_url, apply_url: j.absolute_url, description: strip(j.content || ""), posted: j.updated_at });
  } else if (ats === "lever") {
    const d = await get(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
    for (const j of Array.isArray(d) ? d : []) out.push({ source: "ats", ats, company, title: j.text, location: j.categories?.location || "", url: j.hostedUrl, apply_url: j.applyUrl || j.hostedUrl, description: j.descriptionPlain || strip(j.description || ""), posted: j.createdAt ? new Date(j.createdAt).toISOString() : undefined });
  } else if (ats === "ashby") {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`);
    for (const j of d?.jobs || []) out.push({ source: "ats", ats, company, title: j.title, location: j.location || "", url: j.jobUrl, apply_url: j.applyUrl || j.jobUrl, description: j.descriptionPlain || strip(j.descriptionHtml || ""), posted: j.publishedAt });
  } else if (ats === "workable") {
    const d = await get(`https://www.workable.com/api/accounts/${encodeURIComponent(token)}?details=true`);
    for (const j of d?.jobs || []) out.push({ source: "ats", ats, company: d?.name || company, title: j.title, location: [j.city, j.state, j.country].filter(Boolean).join(", "), url: j.url, apply_url: j.application_url || j.url, description: strip(j.description || "") , posted: j.published_on });
  } else if (ats === "smartrecruiters") {
    const d = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`);
    for (const j of d?.content || []) out.push({ source: "ats", ats, company: j.company?.name || company, title: j.name, location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", "), url: `https://jobs.smartrecruiters.com/${token}/${j.id}`, apply_url: `https://jobs.smartrecruiters.com/${token}/${j.id}`, description: "", posted: j.releasedDate });
  } else if (ats === "workday") {
    const [tenant, wd, site] = token.split("|");
    if (tenant && wd && site) {
      const host = `https://${tenant}.${wd}.myworkdayjobs.com`;
      const d = await get(`${host}/wday/cxs/${tenant}/${site}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText }) });
      for (const j of d?.jobPostings || []) out.push({ source: "ats", ats, company, title: j.title, location: j.locationsText || "", url: `${host}/${site}${j.externalPath}`, apply_url: `${host}/${site}${j.externalPath}`, description: "", posted: j.postedOn });
    }
  }
  return out;
}

function titleScore(title: string, targets: string[]): number {
  const t = norm(title);
  let best = 0;
  for (const target of targets) {
    const words = norm(target).split(" ").filter((w) => w.length > 2 && !/^(and|the|of|for)$/.test(w));
    if (!words.length) continue;
    const hit = words.filter((w) => t.includes(w)).length / words.length;
    best = Math.max(best, hit);
  }
  if (/senior|sr\.|lead|principal|director|manager|vp|head of/i.test(title) && !targets.some((x) => /senior|sr|lead|principal|director|manager/i.test(x))) best *= 0.8;
  return best;
}

function locationScore(loc: string, targets: string[]): number {
  if (!targets.length) return 0.6;
  const l = norm(loc);
  if (/remote/.test(l)) return 0.8;
  for (const t of targets) {
    const n = norm(t);
    if (!n) continue;
    if (l.includes(n)) return 1;
    if (n.length === 2 && new RegExp(`\\b${n}\\b`).test(l)) return 1;
  }
  return /united states|usa|\bus\b/.test(l) ? 0.4 : 0.1;
}

async function discover(names: string[]): Promise<Array<{ name: string; ats: string; token: string }>> {
  const found: Array<{ name: string; ats: string; token: string }> = [];
  for (const name of names.slice(0, 15)) {
    const slug = norm(name).replace(/\b(inc|llc|llp|corp|corporation|company|co|group|ltd)\b/g, "").trim().replace(/ /g, "");
    if (!slug) continue;
    const probes: Array<[string, string]> = [["greenhouse", `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`], ["lever", `https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`], ["ashby", `https://api.ashbyhq.com/posting-api/job-board/${slug}`], ["workable", `https://www.workable.com/api/accounts/${slug}`], ["smartrecruiters", `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`]];
    for (const [ats, url] of probes) {
      const d = await get(url, {}, 6000);
      const ok = d && (Array.isArray(d) ? true : (d.jobs || d.content || d.name));
      if (ok) { found.push({ name, ats, token: slug }); break; }
    }
  }
  return found;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const base = Deno.env.get("INSFORGE_BASE_URL")!;
  const client = createClient({ baseUrl: base, accessToken: token });
  const { data: u } = await client.auth.getCurrentUser();
  const user = u?.user;
  if (!user?.id) return json({ error: "Session expired. Sign in again." }, 401);
  const { data: cands } = await client.database.from("candidates").select("field, target_titles, target_locations, access_ok").eq("id", user.id).limit(1);
  const p = cands?.[0] || {};
  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const titles: string[] = (body.titles?.length ? body.titles : p.target_titles) || [];
  const locations: string[] = (body.locations?.length ? body.locations : p.target_locations) || [];
  const field: string = body.field || p.field || "";
  const limit = Math.min(60, Math.max(5, +body.limit || 30));
  if (!titles.length) return json({ error: "Add target job titles to your profile first." }, 400);

  const admin = createAdminClient({ baseUrl: base, apiKey: Deno.env.get("API_KEY")! });
  // Optional discovery of new employers by name (public ATS probes); stored for everyone.
  let discovered: any[] = [];
  if (Array.isArray(body.discover) && body.discover.length) {
    discovered = await discover(body.discover.map(String));
    if (discovered.length) await admin.database.from("companies").insert(discovered.map((d) => ({ ...d, fields: field ? [field] : [], added_by: user.id })));
  }

  // Which employers to read: explicit list, else companies tagged with the candidate's field (fallback: all active).
  let companies: any[] = Array.isArray(body.companies) && body.companies.length ? body.companies : [];
  if (!companies.length) {
    const { data } = await client.database.from("companies").select("name, ats, token, fields").eq("active", true).limit(200);
    const all = data || [];
    companies = field ? all.filter((c: any) => (c.fields || []).some((f: string) => field.startsWith(f) || f.startsWith(field))) : all;
    if (!companies.length) companies = all;
  }
  companies = [...companies, ...discovered].slice(0, 40);

  const searchText = titles[0] || "";
  const results = await Promise.all(companies.map((c) => feed(c.ats, c.token, c.name, searchText).catch(() => [] as Found[])));
  const seen = new Set<string>();
  const scored = results.flat().filter((j) => j.url && j.title && !seen.has(j.url) && seen.add(j.url)).map((j) => {
    const ts = titleScore(j.title, titles), ls = locationScore(j.location, locations);
    return { ...j, score: Math.round((ts * 0.7 + ls * 0.3) * 100) / 100 };
  }).filter((j) => j.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, limit);

  // Store (skip URLs already known to this candidate).
  const { data: known } = await client.database.from("jobs").select("url").eq("candidate_id", user.id).limit(2000);
  const knownUrls = new Set((known || []).map((k: any) => k.url));
  const rows = scored.filter((j) => !knownUrls.has(j.url)).map((j) => ({
    candidate_id: user.id, source: j.source, ats: j.ats, company: j.company, title: j.title, location: j.location, url: j.url, apply_url: j.apply_url,
    description: (j.description || "").slice(0, 12000), years_required: yearsRequired(j.description), score: j.score, status: "found",
  }));
  if (rows.length) {
    const { error } = await client.database.from("jobs").insert(rows);
    if (error) return json({ error: error.message }, 500);
  }
  return json({ employers: companies.length, fetched: results.flat().length, matched: scored.length, added: rows.length, discovered, jobs: scored.map((j) => ({ ...j, description: (j.description || "").slice(0, 400) })) });
}

function yearsRequired(text: string): number | null {
  const rx = /(\d{1,2})\s*\+?\s*(?:to\s*\d{1,2}\s*)?(?:years?|yrs?)/gi;
  let best: number | null = null; let m;
  while ((m = rx.exec(text || ""))) { const n = +m[1]; if (n >= 1 && n <= 30 && (best === null || n > best)) best = n; }
  return best;
}
