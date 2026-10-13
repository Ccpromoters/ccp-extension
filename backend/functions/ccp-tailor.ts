// ccp-tailor: the extension sends the resume blocks + a job description; the function asks Claude
// (CCP's key, server-side) for the smallest truthful edit plan and returns it. The .docx editing
// itself happens inside the extension, so the master file never leaves the browser.
import { createClient, createAdminClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PRICES: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["job", "candidate_years", "experience_gap", "summary_edits", "skills", "bullets", "already_matched", "gaps", "confirm", "notes"],
  properties: {
    job: { type: "object", additionalProperties: false, required: ["title", "company", "years_required", "location", "employment_type"],
      properties: { title: { type: "string" }, company: { type: "string" }, years_required: { type: ["integer", "null"] }, location: { type: "string" }, employment_type: { type: "string" } } },
    candidate_years: { type: ["integer", "null"] },
    experience_gap: { type: "string" },
    summary_edits: { type: "array", items: { type: "object", additionalProperties: false, required: ["block_id", "new_text"], properties: { block_id: { type: "integer" }, new_text: { type: "string" } } } },
    skills: { type: "array", items: { type: "object", additionalProperties: false, required: ["block_id", "add"], properties: { block_id: { type: "integer" }, add: { type: "array", items: { type: "string" } } } } },
    bullets: { type: "array", items: { type: "object", additionalProperties: false, required: ["action", "block_id", "old", "new", "text"],
      properties: { action: { type: "string", enum: ["modify", "add_after"] }, block_id: { type: "integer" }, old: { type: "string" }, new: { type: "string" }, text: { type: "string" } } } },
    already_matched: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    confirm: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

function systemPrompt(maxBullets: number, allowSummary: boolean) {
  return `You are a resume editor for a US staffing team. You receive a candidate's current resume as numbered blocks and one job description (JD). Propose the SMALLEST set of truthful edits that align the resume's wording with the JD, then report the gaps honestly. The resume is already final; you are tuning it for one job, not rewriting it.

Hard rules - never break these:
1. Never invent or change facts. No new employers, job titles, dates, years of experience, degrees, certifications, licenses, clearances, tools, products, customers, metrics, percentages or counts. If the resume does not already evidence something, it is a gap or a confirm item, not an edit.
2. Never edit blocks marked read-only. Never touch the header, employer/title/date lines, education or certifications.
3. Keep the candidate's voice and format: plain wording, same tense and length as the neighbouring bullets, no first person, no buzzword lists, no exaggeration.
4. Years of experience: work out the candidate's total years from the dates in the resume (candidate_years). If the JD asks for more, say so plainly in experience_gap. Never adjust dates or claim more years - the team decides whether to submit.
5. A skill term may be added to a SKILL block only when the JD uses it AND the resume already shows the same capability under another name, or it is an inherent part of work the resume already describes in that candidate's own environment. Use the JD's exact wording, put it in the SKILL block whose label fits best, never create new rows, and never repeat something the resume already says.
6. Bullet edits: at most ${maxBullets} in total. Prefer "modify" with a small phrase-level change ("old" -> "new", where "old" is an exact substring of that bullet). Use "add_after" only when no existing bullet can carry a JD point; a new bullet must restate or expand work the resume already evidences, placed after a bullet in the same job, and leave "text" as the full new bullet.
${allowSummary ? "7. Summary edits: at most 2 SUMMARY blocks, rewording to mirror the JD's terminology without adding any new claim, number or tool. Return the full new paragraph." : "7. Do not propose summary edits (disabled)."}
8. Candidate-specific rules supplied by the user override the rules above whenever they are stricter.
9. Report: already_matched = JD requirements the resume already covers; gaps = requirements the candidate clearly does not meet (these decide whether to submit); confirm = plausible items to ask the candidate before adding, including any restricted term you would have liked to use. notes = one or two sentences for the recruiter.

Output JSON only, following the schema exactly. Use the block ids from the listing. Use empty strings and empty arrays when nothing applies.`;
}

function parseLoose(text: string) {
  const t = (text || "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1]); } catch { /* fall through */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("The model did not return valid JSON.");
}

async function claude(system: string, user: string, schema: unknown, maxTokens = 8000, effort = "high") {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("The CCP AI key is not configured on the server (ANTHROPIC_API_KEY).");
  const model = Deno.env.get("CCP_MODEL") || "claude-opus-5-5";
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" };
  const messages = [{ role: "user", content: user }];
  let res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, fallbacks: "default", output_config: { effort, format: { type: "json_schema", schema } } }) });
  if (res.status === 400) {
    const t = await res.text();
    if (/output_config|format|fallbacks|json_schema|effort|anthropic-beta/i.test(t)) {
      delete headers["anthropic-beta"];
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify({ model, max_tokens: maxTokens, system: `${system}\n\nRespond with a single JSON object only.`, messages }) });
    } else throw new Error(`AI error 400: ${t.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
  const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const usage = data.usage || {};
  const [pin, pout] = PRICES[data.model] || PRICES[model] || [4, 20];
  const cost = ((usage.input_tokens || 0) * pin + (usage.output_tokens || 0) * pout) / 1e6;
  return { json: parseLoose(text), usage, model: data.model || model, cost };
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
  const { data: cand } = await client.database.from("candidates").select("access_ok, rules, blocked_terms").eq("id", user.id).limit(1);
  if (!cand?.[0]?.access_ok) return json({ error: "Your CCP access is not active yet. Enter the access code in Settings." }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const blocks = String(body.blocks || "");
  const jd = String(body.jd || "").trim().slice(0, 14000);
  if (!blocks || jd.length < 80) return json({ error: "blocks and jd are required" }, 400);
  const limits = { maxBulletChanges: Math.max(0, +body.limits?.maxBulletChanges || 2), maxSkillTerms: Math.max(0, +body.limits?.maxSkillTerms || 8), allowSummaryEdit: body.limits?.allowSummaryEdit !== false };
  const rules = [cand[0].rules, body.rules].filter(Boolean).join("\n");
  const job = body.job || {};
  const userMsg = `CANDIDATE RULES (from the team):\n${rules || "(none)"}\n\nLIMITS: at most ${limits.maxBulletChanges} bullet changes, at most ${limits.maxSkillTerms} new skill terms in total${limits.allowSummaryEdit ? ", summary edits allowed" : ", no summary edits"}.\n\nRESUME BLOCKS:\n${blocks}\n\nJOB DESCRIPTION${job.title ? ` (${job.title}${job.company ? " at " + job.company : ""})` : ""}:\n${jd}`;

  try {
    const r = await claude(systemPrompt(limits.maxBulletChanges, limits.allowSummaryEdit), userMsg, PLAN_SCHEMA, 8000, body.effort || "high");
    const admin = createAdminClient({ baseUrl: base, apiKey: Deno.env.get("API_KEY")! });
    await admin.database.from("ai_calls").insert([{ candidate_id: user.id, kind: "tailor", model: r.model, input_tokens: r.usage.input_tokens || 0, output_tokens: r.usage.output_tokens || 0, cost_usd: r.cost }]);
    return json({ plan: r.json, usage: r.usage, model: r.model });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
