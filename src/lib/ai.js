// AI client (raw HTTP - the extension ships without a build step, so the SDK is not bundled).
// Default provider is the Anthropic Messages API called directly from the browser with the
// user's own key; an OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Ollama...) is optional.

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 - best quality (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 - faster, cheaper" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 - fastest, cheapest" },
];
export const EFFORTS = ["low", "medium", "high", "xhigh"];

export class AiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

export function parseJsonLoose(text) {
  const t = (text || "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  }
  throw new AiError("The model did not return valid JSON. Try again.");
}

function apiMessage(bodyText, status) {
  let msg = "";
  try {
    msg = JSON.parse(bodyText)?.error?.message || "";
  } catch {}
  if (status === 401) return "API key was rejected (401). Check the key in Settings.";
  if (status === 403) return "This key is not allowed to call the API (403).";
  if (status === 429) return "Rate limited (429). Wait a minute and try again.";
  if (status === 529 || status === 503) return "The AI service is overloaded right now. Try again shortly.";
  return msg ? `API error ${status}: ${msg}` : `API error ${status}`;
}

async function anthropicJson(settings, { system, user, schema, maxTokens, effort }) {
  const key = (settings.apiKey || "").trim();
  if (!key) throw new AiError("No API key yet. Open Settings and add your Anthropic API key.", { code: "no_key" });
  const model = settings.model || DEFAULT_MODEL;
  const base = (settings.apiBaseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-beta": "server-side-fallback-2026-07-01",
  };
  const messages = [{ role: "user", content: user }];
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    fallbacks: "default",
    output_config: { effort: effort || settings.effort || "high", format: { type: "json_schema", schema } },
  };
  let res = await fetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 400) {
    // Gateways and proxies may not support structured outputs / fallbacks yet: retry the plain form.
    const errText = await res.text();
    if (/output_config|format|fallbacks|json_schema|effort|anthropic-beta/i.test(errText)) {
      const plain = { model, max_tokens: maxTokens, system: `${system}\n\nRespond with a single JSON object only, no prose.`, messages };
      const h = { ...headers };
      delete h["anthropic-beta"];
      res = await fetch(`${base}/v1/messages`, { method: "POST", headers: h, body: JSON.stringify(plain) });
    } else {
      throw new AiError(apiMessage(errText, 400), { status: 400 });
    }
  }
  if (!res.ok) throw new AiError(apiMessage(await res.text(), res.status), { status: res.status });
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    const why = data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : "";
    throw new AiError(`The model declined this request${why}.`);
  }
  if (data.stop_reason === "max_tokens") throw new AiError("The model ran out of output room. Try again or shorten the job description.");
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return { json: parseJsonLoose(text), usage: data.usage, model: data.model };
}

async function openaiJson(settings, { system, user, schema, maxTokens }) {
  const base = (settings.apiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = settings.model || "";
  if (!model) throw new AiError("Set the model name for your OpenAI-compatible endpoint in Settings.");
  const headers = { "content-type": "application/json" };
  if ((settings.apiKey || "").trim()) headers.authorization = `Bearer ${settings.apiKey.trim()}`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: `${user}\n\nReturn ONLY a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` },
  ];
  const body = { model, messages, temperature: 0.2, max_tokens: maxTokens, response_format: { type: "json_object" } };
  let res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  if (res.status === 400) {
    const errText = await res.text();
    if (/response_format|json_object/i.test(errText)) {
      delete body.response_format;
      res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
    } else throw new AiError(apiMessage(errText, 400), { status: 400 });
  }
  if (!res.ok) throw new AiError(apiMessage(await res.text(), res.status), { status: res.status });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { json: parseJsonLoose(text), usage: data.usage, model: data.model };
}

/** Ask the configured provider for a JSON object. */
export async function generateJson(settings, opts) {
  const provider = settings.apiProvider || "anthropic";
  const o = { maxTokens: 8000, ...opts };
  if (provider === "anthropic") return anthropicJson(settings, o);
  if (provider === "openai") return openaiJson(settings, o);
  throw new AiError(`Unknown AI provider "${provider}"`);
}

/** Cheap connectivity check used by the Settings page. */
export async function testConnection(settings) {
  const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const r = await generateJson(settings, { system: "Reply with JSON.", user: 'Return {"ok": true}.', schema, maxTokens: 2000, effort: "low" });
  if (!r.json || r.json.ok !== true) throw new AiError("Unexpected reply from the model.");
  return r;
}

// ----------------------------------------------------------------------------- tailoring prompt

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["job", "candidate_years", "experience_gap", "summary_edits", "skills", "bullets", "already_matched", "gaps", "confirm", "notes"],
  properties: {
    job: {
      type: "object",
      additionalProperties: false,
      required: ["title", "company", "years_required", "location", "employment_type"],
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        years_required: { type: ["integer", "null"] },
        location: { type: "string" },
        employment_type: { type: "string" },
      },
    },
    candidate_years: { type: ["integer", "null"] },
    experience_gap: { type: "string" },
    summary_edits: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["block_id", "new_text"], properties: { block_id: { type: "integer" }, new_text: { type: "string" } } },
    },
    skills: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["block_id", "add"], properties: { block_id: { type: "integer" }, add: { type: "array", items: { type: "string" } } } },
    },
    bullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "block_id", "old", "new", "text"],
        properties: {
          action: { type: "string", enum: ["modify", "add_after"] },
          block_id: { type: "integer" },
          old: { type: "string" },
          new: { type: "string" },
          text: { type: "string" },
        },
      },
    },
    already_matched: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    confirm: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

export function systemPrompt({ maxBulletChanges = 2, allowSummaryEdit = true } = {}) {
  return `You are a resume editor for a US staffing team. You receive a candidate's current resume as numbered blocks and one job description (JD). Propose the SMALLEST set of truthful edits that align the resume's wording with the JD, then report the gaps honestly. The resume is already final; you are tuning it for one job, not rewriting it.

Hard rules - never break these:
1. Never invent or change facts. No new employers, job titles, dates, years of experience, degrees, certifications, licenses, clearances, tools, products, customers, metrics, percentages or counts. If the resume does not already evidence something, it is a gap or a confirm item, not an edit.
2. Never edit blocks marked read-only. Never touch the header, employer/title/date lines, education or certifications.
3. Keep the candidate's voice and format: plain wording, same tense and length as the neighbouring bullets, no first person, no buzzword lists, no exaggeration.
4. Years of experience: work out the candidate's total years from the dates in the resume (candidate_years). If the JD asks for more, say so plainly in experience_gap. Never adjust dates or claim more years - the team decides whether to submit.
5. A skill term may be added to a SKILL block only when the JD uses it AND the resume already shows the same capability under another name, or it is an inherent part of work the resume already describes in that candidate's own environment. Use the JD's exact wording, put it in the SKILL block whose label fits best, never create new rows, and never repeat something the resume already says.
6. Bullet edits: at most ${maxBulletChanges} in total. Prefer "modify" with a small phrase-level change ("old" -> "new", where "old" is an exact substring of that bullet). Use "add_after" only when no existing bullet can carry a JD point; a new bullet must restate or expand work the resume already evidences, placed after a bullet in the same job, and leave "text" as the full new bullet.
${allowSummaryEdit ? "7. Summary edits: at most 2 SUMMARY blocks, rewording to mirror the JD's terminology without adding any new claim, number or tool. Return the full new paragraph." : "7. Do not propose summary edits (disabled)."}
8. Candidate-specific rules supplied by the user override the rules above whenever they are stricter.
9. Report: already_matched = JD requirements the resume already covers; gaps = requirements the candidate clearly does not meet (these decide whether to submit); confirm = plausible items to ask the candidate before adding, including any restricted term you would have liked to use. notes = one or two sentences for the recruiter.

Output JSON only, following the schema exactly. Use the block ids from the listing. Use empty strings and empty arrays when nothing applies.`;
}

export function userPrompt({ rules, blocks, jd, job, limits }) {
  const jdText = (jd || "").trim().slice(0, 14000);
  return `CANDIDATE RULES (from the team):
${(rules || "").trim() || "(none)"}

LIMITS: at most ${limits.maxBulletChanges} bullet changes, at most ${limits.maxSkillTerms} new skill terms in total${limits.allowSummaryEdit ? ", summary edits allowed" : ", no summary edits"}.

RESUME BLOCKS:
${blocks}

JOB DESCRIPTION${job?.title ? ` (${job.title}${job.company ? " at " + job.company : ""})` : ""}:
${jdText}`;
}
