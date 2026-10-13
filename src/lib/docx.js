// Word (.docx) resume engine: read the document, split it into editable blocks, apply a small
// edit plan (skill terms, bullet edits, summary rewording) while keeping every other byte of the
// document untouched, verify, and write the document back.
//
// The XML is edited as a string (no DOM), so the same code runs in the extension and in Node tests.
// Only word/document.xml is rewritten; styles, numbering, properties etc. are copied as-is.

import { readZip, writeZip, bytesToText, textToBytes } from "./zip.js";

export class DocxError extends Error {}
export class PlanError extends Error {}

const DOC_PART = "word/document.xml";

// ----------------------------------------------------------------------------- text helpers

export const norm = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

export function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

const wordRx = (term) => new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");

// ----------------------------------------------------------------------------- XML scanning

/** End index (exclusive) of the element whose start tag begins at `start`. Handles nesting and self-closing tags. */
export function elementEnd(xml, name, start) {
  const tagEnd = xml.indexOf(">", start);
  if (tagEnd < 0) throw new DocxError(`Unterminated <${name}> tag`);
  if (xml[tagEnd - 1] === "/") return tagEnd + 1;
  const tokenRx = new RegExp(`<${name}(?=[\\s/>])|</${name}>`, "g");
  tokenRx.lastIndex = tagEnd + 1;
  let depth = 1;
  let m;
  while ((m = tokenRx.exec(xml))) {
    if (m[0].startsWith("</")) {
      if (--depth === 0) return m.index + m[0].length;
    } else {
      const te = xml.indexOf(">", m.index);
      if (xml[te - 1] !== "/") depth++;
      tokenRx.lastIndex = te + 1;
    }
  }
  throw new DocxError(`Unbalanced <${name}> element`);
}

function* elements(xml, name, from, to) {
  const rx = new RegExp(`<${name}(?=[\\s/>])`, "g");
  rx.lastIndex = from;
  let m;
  while ((m = rx.exec(xml)) && m.index < to) {
    const end = elementEnd(xml, name, m.index);
    yield { start: m.index, end };
    rx.lastIndex = end;
  }
}

/** Direct child paragraphs and tables of a span (nested ones are skipped). */
function* children(xml, from, to) {
  const rx = /<w:(p|tbl)(?=[\s/>])/g;
  rx.lastIndex = from;
  let m;
  while ((m = rx.exec(xml)) && m.index < to) {
    const name = `w:${m[1]}`;
    const end = elementEnd(xml, name, m.index);
    yield { name, start: m.index, end };
    rx.lastIndex = end;
  }
}

function parseRun(r, start, end) {
  const rPr = (r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [, ""])[1];
  const bold = /<w:b(?=[\s/])(?![^>]*w:val="(?:0|false|off)")/.test(rPr);
  let text = "";
  let hasText = false;
  const rx = /<w:t(?=[\s/>])(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:t>)|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g;
  let m;
  while ((m = rx.exec(r))) {
    if (m[0].startsWith("<w:t")) {
      hasText = true;
      text += unescapeXml(m[1] || "");
    } else if (m[0].startsWith("<w:tab")) text += "\t";
    else text += "\n";
  }
  return { start, end, text, bold, hasText };
}

function parseParagraph(xml, start, end) {
  const p = xml.slice(start, end);
  const pm = p.match(/^<w:p(?:\s[^>]*)?>\s*<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const pPr = pm ? pm[1] : "";
  const isBullet = /<w:numPr>/.test(pPr) || /<w:pStyle w:val="(?:ListParagraph|ListBullet|ListNumber)[^"]*"/i.test(pPr);
  const runs = [];
  const rx = /<w:r(?=[\s/>])/g;
  rx.lastIndex = pm ? pm[0].length : 0;
  let m;
  while ((m = rx.exec(p))) {
    const rEnd = elementEnd(p, "w:r", m.index);
    runs.push(parseRun(p.slice(m.index, rEnd), start + m.index, start + rEnd));
    rx.lastIndex = rEnd;
  }
  return { start, end, isBullet, runs, text: runs.map((r) => r.text).join("") };
}

function tableRows(xml, start, end) {
  const rows = [];
  for (const tr of elements(xml, "w:tr", start, end)) {
    const cells = [];
    for (const tc of elements(xml, "w:tc", tr.start, tr.end)) {
      const paras = [];
      for (const el of children(xml, tc.start, tc.end)) {
        if (el.name === "w:p") paras.push(parseParagraph(xml, el.start, el.end));
        else for (const row of tableRows(xml, el.start, el.end)) for (const c of row.cells) paras.push(...c.paras);
      }
      cells.push({ start: tc.start, end: tc.end, paras, text: paras.map((p) => p.text).join("\n") });
    }
    const head = xml.slice(tr.start, Math.min(tr.end, tr.start + 800));
    rows.push({ start: tr.start, end: tr.end, cells, header: /<w:tblHeader\b/.test(head) });
  }
  return rows;
}

// ----------------------------------------------------------------------------- blocks

const CONTACT_RX = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|linkedin\.com\/in\//i;
const YEAR_RX = /\b(?:19|20)\d{2}\b/;
// Paragraphs that imitate bullets with a typed glyph instead of Word list formatting.
const GLYPH_RX = /^([▪•◦●■□➢➤►\-–—*]|•|o)\s*(?=\S)/;
const NOT_SKILL_LABELS = new Set(["environment", "certified", "in progress", "training", "certifications", "tools used", "technologies used", "note"]);

function sectionKind(headingText) {
  const h = headingText.toLowerCase();
  if (/summary|profile|objective|about|overview/.test(h)) return "summary";
  if (/experience|employment|work history|career history|professional background/.test(h)) return "experience";
  if (/skill|competenc|technical|technolog|expertise|tools|proficienc/.test(h)) return "skills";
  if (/education|certif|licens|language|reference|contact|personal|award|publication|training|affiliation|clearance/.test(h)) return "locked";
  return "other";
}

function skillLabel(para) {
  const runs = para.runs.filter((r) => r.hasText && r.text.trim());
  if (runs.length < 2 || !runs[0].bold) return null;
  const label = runs[0].text.trim();
  if (!label.endsWith(":") || label.length > 60) return null;
  const name = label.slice(0, -1).trim();
  if (NOT_SKILL_LABELS.has(name.toLowerCase())) return null;
  return name;
}

function isHeading(para) {
  const t = norm(para.text);
  if (!t || t.length > 60 || para.isBullet) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  const textRuns = para.runs.filter((r) => r.hasText && r.text.trim());
  return textRuns.length > 0 && textRuns.every((r) => r.bold) && !/[.:;]$/.test(t) && t.split(" ").length <= 6;
}

/**
 * Split document.xml into blocks. Each block: { id, kind, label, text, locked, section, pStart, pEnd }.
 * kind: heading | summary | bullet | skill | para | empty. Editable kinds: summary, bullet, skill (when !locked).
 */
export function parseBlocks(xml) {
  const bodyStart = xml.indexOf("<w:body>");
  const bodyEnd = xml.lastIndexOf("</w:body>");
  if (bodyStart < 0 || bodyEnd < 0) throw new DocxError("document.xml has no <w:body>");

  const blocks = [];
  let section = "";
  let sKind = "other";

  const addPara = (para) => {
    const text = para.text;
    const t = norm(text);
    const b = { id: blocks.length, kind: "para", label: "", text, locked: false, section, pStart: para.start, pEnd: para.end };
    const glyph = !para.isBullet && t.length > 12 && GLYPH_RX.test(t) && !/\n/.test(text.trim()) ? t.match(GLYPH_RX)[0] : "";
    if (!t) {
      b.kind = "empty";
      b.locked = true;
    } else if (para.isBullet || (glyph && sKind !== "skills")) {
      b.kind = "bullet";
      b.locked = sKind === "locked";
      if (glyph) b.glyph = glyph;
    } else if (isHeading(para)) {
      b.kind = "heading";
      b.locked = true;
      section = t;
      sKind = sectionKind(t);
    } else {
      const label = skillLabel(para);
      if (label && sKind !== "locked") {
        b.kind = "skill";
        b.label = label;
      } else if (sKind === "skills" && t.length > 20) {
        // A plain list of tools under a skills heading ("TECHNICAL TOOLS: AutoCAD, Revit, ...").
        b.kind = "skill";
        b.label = section.replace(/\s+/g, " ").replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
      } else if (sKind === "summary" && t.length > 60) {
        b.kind = "summary";
      } else {
        b.locked = true;
      }
    }
    if (blocks.length < 3 || CONTACT_RX.test(t) || (b.kind !== "bullet" && b.kind !== "skill" && t.length <= 120 && YEAR_RX.test(t))) {
      if (b.kind !== "heading") b.kind = "para";
      b.locked = true;
    }
    blocks.push(b);
  };

  for (const el of children(xml, bodyStart, bodyEnd)) {
    if (el.name === "w:p") {
      addPara(parseParagraph(xml, el.start, el.end));
      continue;
    }
    const rows = tableRows(xml, el.start, el.end);
    rows.forEach((row, i) => {
      if (row.cells.length < 2) {
        for (const c of row.cells) for (const p of c.paras) addPara(p);
        return;
      }
      const label = norm(row.cells[0].text);
      const value = row.cells[row.cells.length - 1];
      const editP = [...value.paras].reverse().find((p) => norm(p.text));
      const shortBold = norm(value.text).length < 40 && value.paras.every((p) => p.runs.filter((r) => r.hasText).every((r) => r.bold));
      const header = row.header || (i === 0 && shortBold);
      blocks.push({
        id: blocks.length, kind: "skill", label, text: value.text,
        locked: header || !editP || sKind === "locked", section,
        pStart: editP ? editP.start : row.start, pEnd: editP ? editP.end : row.end,
      });
    });
  }
  return blocks;
}

export function blocksText(blocks) {
  return blocks.filter((b) => b.kind !== "empty").map((b) => (b.label ? `${b.label}: ${b.text}` : b.text)).join("\n");
}

/** Compact listing for the model. Contact details are redacted when `redact` is true. */
export function blocksForModel(blocks, { redact = true } = {}) {
  const lines = [];
  for (const b of blocks) {
    if (b.kind === "empty") continue;
    let text = norm(b.text);
    if (redact && b.locked && CONTACT_RX.test(text)) {
      text = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, "[phone]");
    }
    const kind = b.kind === "heading" ? "HEADING" : b.kind === "skill" ? `SKILL "${b.label}"` : b.kind === "summary" ? "SUMMARY" : b.kind === "bullet" ? "BULLET" : "TEXT";
    const ro = b.locked || b.kind === "heading" || b.kind === "para" ? " (read-only)" : "";
    lines.push(`[#${b.id} ${kind}${ro}] ${text}`);
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------- paragraph surgery

const T_RX = /<w:t(?=[\s/>])(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:t>)/g;

function stripParaIds(pXml) {
  return pXml.replace(/\s+w14:(?:paraId|textId)="[^"]*"/g, "");
}

/** Rewrite a paragraph so that its text runs contain exactly `text` (first text run keeps its formatting). */
function setParagraphText(xml, para, text) {
  const textRuns = para.runs.filter((r) => r.hasText);
  if (!textRuns.length) throw new PlanError("Paragraph has no text run to edit");
  const first = textRuns[0];
  let runXml = xml.slice(first.start, first.end);
  let placed = false;
  runXml = runXml.replace(T_RX, () => {
    if (placed) return "";
    placed = true;
    return `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`;
  });
  let out = xml.slice(para.start, first.start) + runXml;
  let cursor = first.end;
  for (const r of textRuns.slice(1)) {
    out += xml.slice(cursor, r.start);
    cursor = r.end;
  }
  out += xml.slice(cursor, para.end);
  return xml.slice(0, para.start) + out + xml.slice(para.end);
}

/**
 * Rewrite the text of a paragraph's last non-empty text run through `fn(text) -> text`, keeping that
 * run's formatting (so a bold "Label:" run stays bold and the items run stays plain).
 */
function editLastRunText(xml, para, fn) {
  const textRuns = para.runs.filter((r) => r.hasText && r.text.trim());
  if (!textRuns.length) throw new PlanError("Paragraph has no text run to extend");
  const last = textRuns[textRuns.length - 1];
  const runXml = xml.slice(last.start, last.end);
  const tokens = [...runXml.matchAll(T_RX)].filter((t) => !t[0].endsWith("/>"));
  if (!tokens.length) throw new PlanError("Paragraph has no text to extend");
  const tok = tokens[tokens.length - 1];
  const inner = unescapeXml(tok[0].replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, ""));
  const newTok = `<w:t xml:space="preserve">${escapeXml(fn(inner))}</w:t>`;
  const newRun = runXml.slice(0, tok.index) + newTok + runXml.slice(tok.index + tok[0].length);
  return xml.slice(0, last.start) + newRun + xml.slice(last.end);
}

/** Replace `oldText` with `newText` inside a paragraph; falls back to a full rewrite when the phrase spans runs. */
function replaceInParagraph(xml, para, oldText, newText) {
  const hits = para.runs.filter((r) => r.hasText && r.text.includes(oldText));
  if (hits.length === 1 && hits[0].text.split(oldText).length === 2) {
    const run = hits[0];
    const runXml = xml.slice(run.start, run.end);
    const tokens = [...runXml.matchAll(T_RX)];
    if (tokens.length === 1 && !tokens[0][0].endsWith("/>")) {
      const tok = tokens[0];
      const inner = unescapeXml(tok[0].replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, ""));
      const newTok = `<w:t xml:space="preserve">${escapeXml(inner.replace(oldText, newText))}</w:t>`;
      const newRun = runXml.slice(0, tok.index) + newTok + runXml.slice(tok.index + tok[0].length);
      return { xml: xml.slice(0, run.start) + newRun + xml.slice(run.end), partial: true };
    }
  }
  if (!para.text.includes(oldText)) throw new PlanError(`Phrase not found in bullet: "${oldText}"`);
  return { xml: setParagraphText(xml, para, para.text.replace(oldText, newText)), partial: false };
}

function insertParagraphAfter(xml, para, text) {
  const clone = stripParaIds(xml.slice(para.start, para.end));
  const cloneDoc = setParagraphText(clone, { ...parseParagraph(clone, 0, clone.length) }, text);
  return xml.slice(0, para.end) + cloneDoc + xml.slice(para.end);
}

// ----------------------------------------------------------------------------- plan application

function anchorOf(blocks, block) {
  const t = norm(block.text);
  const same = blocks.filter((b) => b.kind === block.kind && b.label === block.label && norm(b.text) === t);
  return { kind: block.kind, label: block.label, text: t, occ: same.findIndex((b) => b.id === block.id) };
}

function findByAnchor(blocks, a) {
  const same = blocks.filter((b) => b.kind === a.kind && b.label === a.label && norm(b.text) === a.text);
  const b = same[a.occ];
  if (!b) throw new PlanError(`Lost track of block "${a.text.slice(0, 60)}..."`);
  return b;
}

function paraAt(xml, block) {
  return parseParagraph(xml, block.pStart, block.pEnd);
}

function newNumbers(text, masterText) {
  const cleaned = text.replace(/\b(?:Tier|Level|L)\s*\d\b/gi, "");
  const nums = new Set((cleaned.match(/\d[\d,.]*\s*%?\+?/g) || []).map((n) => n.trim().replace(/[.,]+$/, "")));
  return [...nums].filter((n) => n && !masterText.includes(n));
}

function hasBlocked(text, blocked, allowed) {
  return blocked.filter((t) => !allowed.has(t.toLowerCase()) && wordRx(t).test(text));
}

/**
 * Apply a plan to a parsed document.
 * plan: { skills: [{block_id, add:[]}], bullets: [{action, block_id, old, new, text}], summary_edits: [{block_id, new_text}] }
 * Returns { xml, blocks, changes, warnings, dropped }.
 */
export function applyPlan(doc, plan, opts = {}) {
  const {
    maxBulletChanges = 2, maxSkillTerms = 8, allowSummaryEdit = true,
    blockedTerms = [], approvedOverrides = [],
  } = opts;
  const allowed = new Set(approvedOverrides.map((s) => s.toLowerCase()));
  const masterText = blocksText(doc.blocks);
  const warnings = [];
  const dropped = [];
  const ops = [];
  const used = new Set();

  const block = (id, kinds, what) => {
    const b = doc.blocks[id];
    if (!b) throw new PlanError(`${what}: block #${id} does not exist`);
    if (!kinds.includes(b.kind) || b.locked) throw new PlanError(`${what}: block #${id} is not editable (${b.kind}${b.locked ? ", read-only" : ""})`);
    if (used.has(id)) throw new PlanError(`${what}: block #${id} is edited twice`);
    return b;
  };

  // skills
  let termCount = 0;
  const addedTerms = [];
  for (const s of plan.skills || []) {
    let b;
    try {
      b = block(s.block_id, ["skill"], "Skill edit");
    } catch (e) {
      dropped.push(e.message);
      continue;
    }
    const terms = [];
    for (const raw of s.add || []) {
      const term = norm(raw);
      if (!term) continue;
      const bl = hasBlocked(term, blockedTerms, allowed);
      if (bl.length) { dropped.push(`"${term}" needs the candidate's confirmation (blocked: ${bl.join(", ")})`); continue; }
      if (wordRx(term).test(masterText) || addedTerms.some((t) => t.toLowerCase() === term.toLowerCase())) { dropped.push(`"${term}" is already in the resume`); continue; }
      if (termCount >= maxSkillTerms) { dropped.push(`"${term}" skipped: limit of ${maxSkillTerms} new skill terms reached`); continue; }
      terms.push(term);
      addedTerms.push(term);
      termCount++;
    }
    if (!terms.length) continue;
    used.add(b.id);
    ops.push({ type: "skill", anchor: anchorOf(doc.blocks, b), terms, label: b.label });
  }

  // bullets
  let bulletCount = 0;
  for (const e of plan.bullets || []) {
    if (bulletCount >= maxBulletChanges) { dropped.push(`Bullet change skipped: limit of ${maxBulletChanges} reached`); continue; }
    let b;
    try {
      b = block(e.block_id, ["bullet"], "Bullet edit");
    } catch (err) {
      dropped.push(err.message);
      continue;
    }
    const action = e.action === "add_after" ? "add_after" : "modify";
    let candidate;
    if (action === "add_after") {
      candidate = norm(e.text);
      if (!candidate) { dropped.push(`Bullet add after #${b.id}: empty text`); continue; }
    } else if (e.old && e.new && b.text.includes(e.old)) {
      candidate = norm(b.text.replace(e.old, e.new));
    } else if (norm(e.text) && norm(e.text) !== norm(b.text)) {
      candidate = norm(e.text);
    } else if (e.old && e.new) {
      dropped.push(`Bullet #${b.id}: phrase "${e.old}" not found`);
      continue;
    } else {
      continue;
    }
    const bl = hasBlocked(candidate, blockedTerms, allowed);
    if (bl.length) { dropped.push(`Bullet edit needs the candidate's confirmation (blocked: ${bl.join(", ")})`); continue; }
    const nums = newNumbers(candidate, masterText);
    if (nums.length) warnings.push(`New number(s) ${nums.join(", ")} in a bullet - keep only if the candidate supplied them`);
    used.add(b.id);
    bulletCount++;
    ops.push({ type: action === "add_after" ? "bullet-add" : "bullet-modify", anchor: anchorOf(doc.blocks, b), old: e.old, new: e.new, text: candidate });
  }

  // summary
  if (allowSummaryEdit) {
    let n = 0;
    for (const s of plan.summary_edits || []) {
      if (n >= 2) { dropped.push("Summary edit skipped: limit of 2"); continue; }
      let b;
      try {
        b = block(s.block_id, ["summary"], "Summary edit");
      } catch (err) {
        dropped.push(err.message);
        continue;
      }
      const text = norm(s.new_text);
      if (!text || text === norm(b.text)) continue;
      const bl = hasBlocked(text, blockedTerms, allowed);
      if (bl.length) { dropped.push(`Summary edit needs the candidate's confirmation (blocked: ${bl.join(", ")})`); continue; }
      const nums = newNumbers(text, masterText);
      if (nums.length) { dropped.push(`Summary edit dropped: it adds number(s) ${nums.join(", ")} that are not in the resume`); continue; }
      used.add(b.id);
      n++;
      ops.push({ type: "summary", anchor: anchorOf(doc.blocks, b), text });
    }
  } else if ((plan.summary_edits || []).length) {
    dropped.push("Summary edits are disabled in settings");
  }

  // apply sequentially, re-parsing after every edit
  let xml = doc.xml;
  let blocks = doc.blocks;
  const changes = [];
  const expected = blocks.map((b) => `${b.kind}|${b.label}|${norm(b.text)}`);
  const expIndex = (b) => blocks.findIndex((x) => x.id === b.id);

  for (const op of ops) {
    const b = findByAnchor(blocks, op.anchor);
    const para = paraAt(xml, b);
    const before = norm(b.text);
    const idx = expIndex(b);
    if (op.type === "skill") {
      // Append to the last run only, so the row keeps its label formatting.
      const sep = para.text.includes(" | ") ? " | " : ", ";
      let after = "";
      xml = editLastRunText(xml, para, (inner) => {
        const trimmed = inner.replace(/\s+$/, "");
        const endsDot = trimmed.endsWith(".");
        const base = endsDot ? trimmed.slice(0, -1) : trimmed;
        const out = `${base}${sep}${op.terms.join(sep)}${endsDot ? "." : ""}`;
        after = para.text.slice(0, para.text.lastIndexOf(inner)) + out;
        return out;
      });
      expected[idx] = `skill|${b.label}|${norm(after)}`;
      changes.push({ type: "skill", label: op.label, added: op.terms, before, after: norm(after) });
    } else if (op.type === "bullet-modify") {
      if (op.old && op.new && para.text.includes(op.old)) {
        const r = replaceInParagraph(xml, para, op.old, op.new);
        xml = r.xml;
        if (!r.partial) warnings.push("One bullet was rewritten as a whole (mixed formatting inside it was flattened)");
      } else {
        xml = setParagraphText(xml, para, op.text);
      }
      expected[idx] = `bullet||${op.text}`;
      changes.push({ type: "bullet-modify", before, after: op.text });
    } else if (op.type === "bullet-add") {
      // Typed-glyph bullets: the new paragraph needs the same glyph the neighbours carry.
      const text = b.glyph && !GLYPH_RX.test(op.text) ? `${b.glyph}${op.text}` : op.text;
      xml = insertParagraphAfter(xml, para, text);
      expected.splice(idx + 1, 0, `bullet||${norm(text)}`);
      changes.push({ type: "bullet-add", anchor: before, text: norm(text) });
    } else if (op.type === "summary") {
      xml = setParagraphText(xml, para, op.text);
      expected[idx] = `summary||${op.text}`;
      changes.push({ type: "summary", before, after: op.text });
    }
    blocks = parseBlocks(xml);
  }

  const actual = blocks.map((b) => `${b.kind}|${b.label}|${norm(b.text)}`);
  if (actual.length !== expected.length || actual.some((a, i) => a !== expected[i])) {
    const i = actual.findIndex((a, j) => a !== expected[j]);
    throw new PlanError(`Verification failed at block ${i}: expected "${(expected[i] || "").slice(0, 80)}" but got "${(actual[i] || "").slice(0, 80)}"`);
  }
  return { xml, blocks, changes, warnings, dropped };
}

// ----------------------------------------------------------------------------- open / save

export async function openDocx(bytes) {
  const zip = await readZip(bytes);
  const part = zip.get(DOC_PART);
  if (!part) throw new DocxError("This is not a Word .docx file (word/document.xml is missing)");
  const xml = bytesToText(await part.data());
  return { zip, xml, blocks: parseBlocks(xml) };
}

/** Write the document back with a new document.xml; every other part is copied byte-for-byte. */
export async function saveDocx(zip, xml) {
  const entries = [];
  for (const e of zip.values()) entries.push(e.name === DOC_PART ? { name: e.name, data: textToBytes(xml) } : e);
  return writeZip(entries);
}

/** Rough size check: number of words added (the extension cannot lay out pages). */
export function wordsAdded(changes) {
  const count = (s) => (norm(s) ? norm(s).split(" ").length : 0);
  let n = 0;
  for (const c of changes) {
    if (c.type === "bullet-add") n += count(c.text);
    else n += Math.max(0, count(c.after) - count(c.before));
  }
  return n;
}
