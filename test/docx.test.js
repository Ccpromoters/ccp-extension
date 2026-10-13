import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDocx, parseBlocks, applyPlan, saveDocx, blocksForModel, PlanError, norm } from "../src/lib/docx.js";
import { buildDocx, buildDocumentXml } from "./helpers.js";

const kinds = (blocks) => blocks.filter((b) => b.kind !== "empty").map((b) => `${b.kind}${b.locked ? "!" : ""}`);

test("parseBlocks classifies headings, summary, table skills, label skills, bullets and locked lines", () => {
  const blocks = parseBlocks(buildDocumentXml());
  const byText = (s) => blocks.find((b) => norm(b.text).startsWith(s));
  assert.equal(byText("JANE SAMPLE").locked, true);
  assert.equal(byText("Dunbar, WV").locked, true);
  assert.equal(byText("PROFESSIONAL SUMMARY").kind, "heading");
  assert.equal(byText("Windows Systems Administrator with").kind, "summary");
  assert.equal(byText("Windows Systems Administrator with").locked, false);
  const virt = blocks.find((b) => b.label === "Virtualization");
  assert.equal(virt.kind, "skill");
  assert.equal(virt.locked, false);
  assert.equal(blocks.find((b) => b.label === "Skill Area").locked, true, "table header row is locked");
  const tools = blocks.find((b) => b.label === "Tools");
  assert.equal(tools.kind, "skill");
  assert.equal(norm(tools.text), "Tools: ServiceNow, SVN, Microsoft Project, Visio.");
  assert.equal(byText("Administered Windows Server 2016").kind, "bullet");
  assert.equal(byText("Systems Administrator\tMay 2016".replace("\t", " ")) ?? byText("Systems Administrator"), blocks.find((b) => /May 2016/.test(b.text)));
  assert.equal(blocks.find((b) => /May 2016/.test(b.text)).locked, true, "title/date line is locked");
  assert.equal(byText("ITIL v3 Foundation").locked, true, "bullets under CERTIFICATIONS are locked");
  assert.equal(byText("Bachelor of Science").locked, true);
});

test("blocksForModel redacts contact details and marks read-only blocks", () => {
  const listing = blocksForModel(parseBlocks(buildDocumentXml()));
  assert.match(listing, /\[email\]/);
  assert.match(listing, /\[phone\]/);
  assert.doesNotMatch(listing, /jane\.sample@example\.com/);
  assert.match(listing, /\[#\d+ SKILL "Virtualization"\] VMware/);
  assert.match(listing, /BULLET\] Administered/);
  assert.match(listing, /HEADING \(read-only\)\] PROFESSIONAL SUMMARY/);
});

test("applyPlan edits only the planned blocks and verifies the rest", async () => {
  const bytes = await buildDocx();
  const doc = await openDocx(bytes);
  const id = (pred) => doc.blocks.find(pred).id;
  const plan = {
    skills: [
      { block_id: id((b) => b.label === "Virtualization"), add: ["vCenter Server", "VMware ESXi"] }, // second is a duplicate
      { block_id: id((b) => b.label === "Tools"), add: ["Jira"] }, // blocked
    ],
    bullets: [
      { action: "modify", block_id: id((b) => /^Managed Active Directory/.test(b.text)), old: "for statewide field offices", new: "for statewide field offices as Tier 3 support", text: "" },
      { action: "add_after", block_id: id((b) => /^Supported VMware/.test(b.text)), old: "", new: "", text: "Maintained ESXi hosts through scheduled maintenance windows and host patching." },
      { action: "modify", block_id: id((b) => /^Administered Windows Server/.test(b.text)), old: "with WSUS", new: "with WSUS and SCCM", text: "" }, // over the limit
    ],
    summary_edits: [{ block_id: id((b) => b.kind === "summary"), new_text: "Windows Systems Administrator with over nine years of experience supporting a statewide agency environment, covering Windows Server, Active Directory, Group Policy, VMware virtualization and backups across many field offices." }],
  };
  const r = applyPlan(doc, plan, { maxBulletChanges: 2, maxSkillTerms: 8, blockedTerms: ["Jira", "Veeam"] });

  assert.equal(r.changes.filter((c) => c.type === "skill").length, 1);
  assert.deepEqual(r.changes.find((c) => c.type === "skill").added, ["vCenter Server"]);
  assert.match(r.changes.find((c) => c.type === "skill").after, /provisioning, vCenter Server\.$/);
  assert.equal(r.changes.filter((c) => c.type === "bullet-modify").length, 1);
  assert.equal(r.changes.filter((c) => c.type === "bullet-add").length, 1);
  assert.equal(r.changes.filter((c) => c.type === "summary").length, 1);
  assert.ok(r.dropped.some((d) => /Jira.*blocked|blocked.*Jira/.test(d)), "blocked term dropped: " + r.dropped.join(" | "));
  assert.ok(r.dropped.some((d) => /already in the resume/.test(d)));
  assert.ok(r.dropped.some((d) => /limit of 2/.test(d)));
  assert.equal(r.warnings.length, 0, r.warnings.join(" | "));

  // Re-open the saved file: the edited blocks changed, nothing else did.
  const out = await saveDocx(doc.zip, r.xml);
  const doc2 = await openDocx(out);
  const before = doc.blocks.map((b) => norm(b.text));
  const after = doc2.blocks.map((b) => norm(b.text));
  assert.equal(after.length, before.length + 1);
  assert.ok(after.includes("Maintained ESXi hosts through scheduled maintenance windows and host patching."));
  assert.ok(after.includes("Managed Active Directory users, groups and Group Policy Objects for statewide field offices as Tier 3 support."));
  const untouched = before.filter((t) => !/^Managed Active Directory|^Windows Systems Administrator with|VMware ESXi \/ vSphere/.test(t));
  for (const t of untouched) assert.ok(after.includes(t), `lost: ${t}`);
  // the inserted bullet copied the anchor's numbering (it is a real bullet)
  assert.equal(doc2.blocks.find((b) => /^Maintained ESXi hosts/.test(b.text)).kind, "bullet");
  // other parts untouched byte-for-byte
  const z1 = doc.zip, z2 = doc2.zip;
  assert.deepEqual([...z2.keys()], [...z1.keys()]);
  assert.equal(z2.get("[Content_Types].xml").crc, z1.get("[Content_Types].xml").crc);
});

test("skill terms are appended to the items run, keeping a bold 'Label:' run intact", async () => {
  const doc = await openDocx(await buildDocx());
  const tools = doc.blocks.find((b) => b.label === "Tools");
  const r = applyPlan(doc, { skills: [{ block_id: tools.id, add: ["Confluence", "Smartsheet"] }] }, {});
  assert.equal(r.changes[0].after, "Tools: ServiceNow, SVN, Microsoft Project, Visio, Confluence, Smartsheet.");
  const doc2 = await openDocx(await saveDocx(doc.zip, r.xml));
  const again = doc2.blocks.find((b) => norm(b.text).startsWith("Tools:"));
  assert.equal(again.kind, "skill", "row is still recognised as a labelled skills row after the edit");
  assert.equal(again.label, "Tools");
  // the label run is still bold and separate from the items run
  const pXml = r.xml.slice(again.pStart, again.pEnd);
  assert.match(pXml, /<w:b\/><w:bCs\/><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">Tools: <\/w:t>/);
  assert.match(pXml, /Visio, Confluence, Smartsheet\.<\/w:t>/);
});

test("applyPlan refuses edits to read-only blocks and reports phrase misses", async () => {
  const doc = await openDocx(await buildDocx());
  const locked = doc.blocks.find((b) => /May 2016/.test(b.text)).id;
  const r = applyPlan(doc, { bullets: [{ action: "modify", block_id: locked, old: "May", new: "June", text: "" }] }, {});
  assert.equal(r.changes.length, 0);
  assert.ok(r.dropped.some((d) => /not editable/.test(d)));
  const bullet = doc.blocks.find((b) => b.kind === "bullet" && !b.locked).id;
  const r2 = applyPlan(doc, { bullets: [{ action: "modify", block_id: bullet, old: "not in there", new: "x", text: "" }] }, {});
  assert.ok(r2.dropped.some((d) => /not found/.test(d)));
});

test("applyPlan flags new numbers in bullets and drops them from the summary", async () => {
  const doc = await openDocx(await buildDocx());
  const bullet = doc.blocks.find((b) => b.kind === "bullet" && !b.locked);
  const summary = doc.blocks.find((b) => b.kind === "summary");
  const r = applyPlan(doc, {
    bullets: [{ action: "modify", block_id: bullet.id, old: "", new: "", text: bullet.text.replace(".", " across 350 servers.") }],
    summary_edits: [{ block_id: summary.id, new_text: summary.text + " Supported 1,200 users." }],
  }, {});
  assert.ok(r.warnings.some((w) => /350/.test(w)));
  assert.ok(r.dropped.some((d) => /Summary edit dropped/.test(d)));
});

test("typed-glyph bullets and plain tool lists under a skills heading are editable", async () => {
  const { writeZip } = await import("../src/lib/zip.js");
  const { P } = await import("./helpers.js");
  const run = (t, bold = false) => `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const body = [
    P(run("SAM GLYPH", true)), P(run("Civil Engineer")), P(run("sam@example.com | (304) 555-0100")),
    P(run("TECHNICAL TOOLS", true)), P(run("AutoCAD, Microsoft Project, STAAD.Pro, ETABS.")),
    P(run("PROFESSIONAL EXPERIENCE", true)), P(run("Project Engineer, Acme | Jan 2024 - Present")),
    P(run("▪Prepared structural drawings and reviewed shop drawings for residential projects.")),
    P(run("▪Performed periodic site inspections to verify work against issued engineering documents.")),
    P(run("CERTIFICATIONS", true)), P(run("▪OSHA 30-Hour Construction Safety")),
  ].join("");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const blocks = parseBlocks(xml);
  const tools = blocks.find((b) => /^AutoCAD/.test(b.text));
  assert.equal(tools.kind, "skill");
  assert.equal(tools.label, "Technical Tools");
  const b1 = blocks.find((b) => /^▪Prepared/.test(b.text));
  assert.equal(b1.kind, "bullet");
  assert.equal(b1.glyph, "▪");
  assert.equal(b1.locked, false);
  assert.equal(blocks.find((b) => /^▪OSHA/.test(b.text)).locked, true, "glyph bullets under CERTIFICATIONS stay locked");
  assert.equal(blocks.find((b) => /^Project Engineer, Acme/.test(b.text)).locked, true);

  const bytes = await writeZip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: xml }]);
  const doc = await openDocx(bytes);
  const r = applyPlan(doc, {
    skills: [{ block_id: tools.id, add: ["Civil 3D"] }],
    bullets: [{ action: "add_after", block_id: b1.id, old: "", new: "", text: "Coordinated submittals with the city reviewer for structural approvals." }],
  }, {});
  assert.equal(r.changes.length, 2);
  assert.match(r.changes[0].after, /ETABS, Civil 3D\.$/);
  assert.match(r.changes[1].text, /^▪Coordinated submittals/);
  const doc2 = await openDocx(await saveDocx(doc.zip, r.xml));
  assert.ok(doc2.blocks.some((b) => b.kind === "bullet" && /^▪Coordinated submittals/.test(b.text)));
});

// Optional: run against a real master resume when one is available on this machine (never committed).
const REAL = process.env.CCP_TEST_DOCX;
test("real resume smoke test (CCP_TEST_DOCX)", { skip: !REAL || !fs.existsSync(REAL) }, async () => {
  const doc = await openDocx(new Uint8Array(fs.readFileSync(REAL)));
  const skills = doc.blocks.filter((b) => b.kind === "skill" && !b.locked);
  const bullets = doc.blocks.filter((b) => b.kind === "bullet" && !b.locked);
  assert.ok(skills.length > 3, "skill rows found");
  assert.ok(bullets.length > 10, "bullets found");
  const r = applyPlan(doc, {
    skills: [{ block_id: skills[0].id, add: ["Example Term Alpha"] }],
    bullets: [{ action: "add_after", block_id: bullets[0].id, old: "", new: "", text: "Example added bullet for the smoke test." }],
  }, {});
  assert.equal(r.changes.length, 2);
  const out = await saveDocx(doc.zip, r.xml);
  const doc2 = await openDocx(out);
  assert.equal(doc2.blocks.length, doc.blocks.length + 1);
});
