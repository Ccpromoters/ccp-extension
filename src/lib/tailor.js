// Orchestrates one tailoring run: resume bytes + JD text -> edit plan (AI) -> edited .docx bytes.

import { openDocx, applyPlan, saveDocx, blocksForModel, blocksText, wordsAdded, PlanError } from "./docx.js";
import { generateJson, PLAN_SCHEMA, systemPrompt, userPrompt } from "./ai.js";
import { keywordGap, yearsRequired } from "./skills-dict.js";

export function parseList(text) {
  return (text || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePlan(p) {
  const plan = p && typeof p === "object" ? p : {};
  const int = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : -1);
  return {
    job: plan.job || {},
    candidate_years: plan.candidate_years ?? null,
    experience_gap: plan.experience_gap || "",
    summary_edits: (plan.summary_edits || []).map((s) => ({ block_id: int(s.block_id), new_text: String(s.new_text || "") })),
    skills: (plan.skills || []).map((s) => ({ block_id: int(s.block_id), add: (s.add || []).map(String) })),
    bullets: (plan.bullets || []).map((b) => ({
      action: b.action === "add_after" ? "add_after" : "modify",
      block_id: int(b.block_id),
      old: String(b.old || ""),
      new: String(b.new || ""),
      text: String(b.text || ""),
    })),
    already_matched: (plan.already_matched || []).map(String),
    gaps: (plan.gaps || []).map(String),
    confirm: (plan.confirm || []).map(String),
    notes: String(plan.notes || ""),
  };
}

/** Offline plan used by the dev harness and tests (no API call). */
export function mockPlan(blocks, gap, years) {
  const skill = blocks.find((b) => b.kind === "skill" && !b.locked);
  const bullet = blocks.find((b) => b.kind === "bullet" && !b.locked);
  const plan = {
    job: { title: "Sample role", company: "Sample Co", years_required: years, location: "", employment_type: "" },
    candidate_years: null,
    experience_gap: years ? `The JD asks for ${years}+ years; check the candidate's dates before submitting.` : "",
    summary_edits: [],
    skills: skill ? [{ block_id: skill.id, add: gap.missing.slice(0, 2).length ? gap.missing.slice(0, 2) : ["sample skill"] }] : [],
    bullets: bullet ? [{ action: "modify", block_id: bullet.id, old: "", new: "", text: `${bullet.text.replace(/\.$/, "")} in line with the job's requirements.` }] : [],
    already_matched: gap.matched,
    gaps: gap.missing.slice(2),
    confirm: [],
    notes: "Mock plan (no AI call). Configure an API key in Settings for real tailoring.",
  };
  return plan;
}

/**
 * Tailor a resume to a JD.
 * @returns {Promise<{bytes:Uint8Array, plan, changes, warnings, dropped, keyword, yearsRequired, wordsAdded, usage}>}
 */
export async function tailorResume({ resumeBytes, jdText, job, settings, approvedOverrides = [], onProgress }) {
  const progress = (m) => onProgress && onProgress(m);
  progress("Reading the resume…");
  const doc = await openDocx(resumeBytes);
  const editable = doc.blocks.filter((b) => !b.locked && ["skill", "bullet", "summary"].includes(b.kind));
  if (!editable.length) {
    throw new PlanError("No editable skills rows, bullet points or summary were found in this resume. The master should use real Word bullets and a skills table or 'Label: items' lines.");
  }
  const jd = (jdText || "").trim();
  if (jd.length < 80) throw new PlanError("The job description is too short. Paste the full JD text.");

  const gap = keywordGap(jd, blocksText(doc.blocks));
  const years = yearsRequired(jd);
  const limits = {
    maxBulletChanges: Math.max(0, +settings.maxBulletChanges || 2),
    maxSkillTerms: Math.max(0, +settings.maxSkillTerms || 8),
    allowSummaryEdit: settings.allowSummaryEdit !== false,
    blockedTerms: parseList(settings.blockedTerms),
    approvedOverrides,
  };

  let plan;
  let usage = null;
  if (settings.apiProvider === "mock") {
    plan = mockPlan(doc.blocks, gap, years);
  } else {
    progress("Asking the model for the smallest truthful edits…");
    const r = await generateJson(settings, {
      system: systemPrompt(limits),
      user: userPrompt({ rules: settings.rules, blocks: blocksForModel(doc.blocks, { redact: settings.redactContacts !== false }), jd, job, limits }),
      schema: PLAN_SCHEMA,
      effort: settings.effort,
    });
    plan = r.json;
    usage = r.usage;
  }
  plan = normalizePlan(plan);

  progress("Applying the edits to the Word file…");
  const result = applyPlan(doc, plan, limits);
  const bytes = await saveDocx(doc.zip, result.xml);
  return {
    bytes,
    plan,
    changes: result.changes,
    warnings: result.warnings,
    dropped: result.dropped,
    keyword: gap,
    yearsRequired: years,
    wordsAdded: wordsAdded(result.changes),
    usage,
  };
}
