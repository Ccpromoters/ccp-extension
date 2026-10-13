// ccp-answer: map an application form's questions to the candidate's stored answers.
// Known questions are answered from the profile (no AI); the rest go to Claude in one call with
// the profile as the only source of truth. Anything the profile cannot answer truthfully comes
// back as needs_candidate so the person decides - never guessed.
import { createClient, createAdminClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const PRICES: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };

type Q = { id: string; label: string; type?: string; options?: string[]; required?: boolean };
type A = { id: string; answer: string | boolean | null; source: string; note?: string; needs_candidate?: boolean };

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Direct rules: label pattern -> profile key or computed answer.
const RULES: Array<[RegExp, (p: any) => string | boolean | null]> = [
  [/^(first|given) ?name/, (p) => p.first_name || (p.full_name || "").split(" ")[0] || null],
  [/^(last|family|sur) ?name/, (p) => p.last_name || (p.full_name || "").split(" ").slice(1).join(" ") || null],
  [/^(full )?name$|^your name|^legal name/, (p) => p.full_name || null],
  [/e-?mail/, (p) => p.email || null],
  [/phone|mobile|cell/, (p) => p.phone || null],
  [/linkedin/, (p) => p.linkedin_url || null],
  [/website|portfolio|github/, (p) => p.website_url || ""],
  [/^(street )?address|address line 1|^address$/, (p) => p.address_line || null],
  [/^city/, (p) => p.city || null],
  [/^state|province/, (p) => p.state || null],
  [/zip|postal/, (p) => p.zip || null],
  [/country/, (p) => p.country || "United States"],
  [/current (company|employer)|most recent employer|^employer$/, (p) => p.employment?.[0]?.company || null],
  [/current (title|position|job title)|^(job )?title$/, (p) => p.employment?.[0]?.title || null],
  [/salary|compensation|pay (expectation|rate)/, (p) => p.desired_salary || null],
  [/start date|available to start|availability|notice period/, (p) => p.available_from || null],
  [/relocat/, (p) => p.willing_to_relocate == null ? null : p.willing_to_relocate],
  [/driver'?s? licen[cs]e/, (p) => p.has_drivers_license == null ? null : p.has_drivers_license],
  [/18 (years|or older)|over 18|at least 18|age of 18/, (p) => p.over_18 !== false],
  [/legally authori[sz]ed|authori[sz]ed to work|eligible to work|work authori[sz]ation/, (p) => p.work_authorization ? p.work_authorization !== "none" : null],
  [/(now or in the future|in the future).*(sponsor|visa)|sponsor.*(now or in the future|future)/, (p) => p.needs_sponsorship_future === "yes" ? true : p.needs_sponsorship_future === "no" ? false : null],
  [/sponsor|visa/, (p) => p.needs_sponsorship_now == null ? null : p.needs_sponsorship_now],
  [/veteran|military/, (p) => p.veteran_status || "decline"],
  [/gender|sex\b/, (p) => p.gender || "decline"],
  [/race|ethnic|hispanic|latino/, (p) => p.race_ethnicity || "decline"],
  [/disab/, (p) => p.disability_status || "decline"],
  [/how did you hear|referr?al source|source/, () => "Job board"],
  [/school|university|college|degree|major|graduat|gpa|education/, (p) => p.education?.[0] ? `${p.education[0].degree || ""} ${p.education[0].school || ""} ${p.education[0].year || ""}`.trim() : null],
];

const DECLINE = /decline|prefer not|do not wish|don't wish|choose not|not to answer|not specified|n\/a/i;

function pickOption(answer: string | boolean | null, options?: string[]): string | null {
  if (!options?.length || answer == null) return null;
  if (typeof answer === "boolean") {
    const yes = options.find((o) => /^yes\b/i.test(o)), no = options.find((o) => /^no\b/i.test(o));
    return answer ? yes || null : no || null;
  }
  const a = norm(String(answer));
  if (a === "decline") return options.find((o) => DECLINE.test(o)) || null;
  const exact = options.find((o) => norm(o) === a);
  if (exact) return exact;
  const starts = options.find((o) => norm(o).startsWith(a) || a.startsWith(norm(o)));
  if (starts) return starts;
  const contains = options.filter((o) => norm(o).includes(a) || a.includes(norm(o)));
  return contains.length === 1 ? contains[0] : null;
}

function parseLoose(text: string) {
  const t = (text || "").trim();
  try { return JSON.parse(t); } catch { /* */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("The model did not return valid JSON.");
}

async function claude(system: string, user: string, schema: unknown) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("The CCP AI key is not configured on the server (ANTHROPIC_API_KEY).");
  const model = Deno.env.get("CCP_ANSWER_MODEL") || Deno.env.get("CCP_MODEL") || "claude-opus-5-5";
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" };
  const messages = [{ role: "user", content: user }];
  let res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 6000, system, messages, fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema", schema } } }) });
  if (res.status === 400) {
    const t = await res.text();
    if (/output_config|format|fallbacks|json_schema|effort|anthropic-beta/i.test(t)) {
      delete headers["anthropic-beta"];
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: 6000, system: `${system}\n\nRespond with a single JSON object only.`, messages }) });
    } else throw new Error(`AI error 400: ${t.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const usage = data.usage || {};
  const [pin, pout] = PRICES[data.model] || PRICES[model] || [4, 20];
  return { json: parseLoose(text), usage, model: data.model || model, cost: ((usage.input_tokens || 0) * pin + (usage.output_tokens || 0) * pout) / 1e6 };
}

const AI_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "answer", "needs_candidate", "note"],
    properties: { id: { type: "string" }, answer: { type: "string" }, needs_candidate: { type: "boolean" }, note: { type: "string" } } } } },
};

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
  const { data: cands } = await client.database.from("candidates").select("*").eq("id", user.id).limit(1);
  const p = cands?.[0];
  if (!p) return json({ error: "Complete your profile first." }, 400);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const questions: Q[] = Array.isArray(body.questions) ? body.questions.slice(0, 80) : [];
  const answers: A[] = [];
  const pending: Q[] = [];

  // 1. profile rules and the question bank
  const { data: bank } = await client.database.from("question_bank").select("pattern, canonical_key").limit(500);
  const bankMap = new Map((bank || []).map((b: any) => [b.pattern, b.canonical_key]));
  for (const q of questions) {
    const label = norm(q.label);
    let value: string | boolean | null | undefined;
    const key = bankMap.get(label);
    if (key && p[key] !== undefined) value = p[key];
    if (value === undefined) {
      const extra = p.extra_answers || {};
      if (extra[label] !== undefined) value = extra[label];
    }
    if (value === undefined) for (const [rx, fn] of RULES) if (rx.test(label)) { value = fn(p); break; }
    if (q.type === "file") { answers.push({ id: q.id, answer: "resume", source: "profile", note: "tailored resume file" }); continue; }
    if (value === undefined) { pending.push(q); continue; }
    if (value === null) { answers.push({ id: q.id, answer: null, source: "needs_candidate", needs_candidate: true, note: "not in your profile yet" }); continue; }
    if (q.options?.length) {
      const opt = pickOption(value, q.options);
      if (opt) answers.push({ id: q.id, answer: opt, source: "profile" });
      else answers.push({ id: q.id, answer: null, source: "needs_candidate", needs_candidate: true, note: `your answer "${value}" does not match the options` });
    } else answers.push({ id: q.id, answer: value, source: "profile" });
  }

  // 2. everything else: one AI call, profile is the only source of truth
  let usage: any = null;
  if (pending.length && p.access_ok) {
    const profile = { ...p };
    delete profile.id; delete profile.access_ok; delete profile.plan;
    const system = `You fill job application forms for a candidate using ONLY the candidate profile JSON. Rules: answer a question only when the profile clearly contains the answer; for choice questions return one option verbatim; for EEO/demographic questions (race, ethnicity, gender, veteran, disability) use the profile value or the "decline/prefer not to answer" option; for visa/sponsorship questions use the profile's work_authorization / needs_sponsorship fields and set needs_candidate=true when they are missing or "unsure"; for free-text questions about motivation or fit, write 2-3 plain honest sentences grounded in the profile and the job title; never invent experience, dates, numbers, licences or certifications. If the profile cannot answer truthfully, return answer "" and needs_candidate=true with a short note. Return JSON only.`;
    const userMsg = `CANDIDATE PROFILE:\n${JSON.stringify(profile)}\n\nJOB: ${JSON.stringify(body.job || {})}\n\nQUESTIONS:\n${JSON.stringify(pending.map((q) => ({ id: q.id, label: q.label, type: q.type || "text", options: q.options || [], required: !!q.required })))}`;
    try {
      const r = await claude(system, userMsg, AI_SCHEMA);
      usage = r.usage;
      const admin = createAdminClient({ baseUrl: base, apiKey: Deno.env.get("API_KEY")! });
      await admin.database.from("ai_calls").insert([{ candidate_id: user.id, kind: "answer", model: r.model, input_tokens: r.usage.input_tokens || 0, output_tokens: r.usage.output_tokens || 0, cost_usd: r.cost }]);
      const byId = new Map((r.json.answers || []).map((a: any) => [a.id, a]));
      for (const q of pending) {
        const a: any = byId.get(q.id);
        if (!a || a.needs_candidate || !a.answer) answers.push({ id: q.id, answer: null, source: "needs_candidate", needs_candidate: true, note: a?.note || "please answer this one" });
        else answers.push({ id: q.id, answer: q.options?.length ? (pickOption(a.answer, q.options) || a.answer) : a.answer, source: "ai", note: a.note || "" });
      }
    } catch (e) {
      for (const q of pending) answers.push({ id: q.id, answer: null, source: "needs_candidate", needs_candidate: true, note: `AI unavailable: ${(e as Error).message}` });
    }
  } else {
    for (const q of pending) answers.push({ id: q.id, answer: null, source: "needs_candidate", needs_candidate: true, note: p.access_ok ? "" : "AI answers need an active CCP access code" });
  }
  return json({ answers, usage });
}
