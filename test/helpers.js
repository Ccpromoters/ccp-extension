// Builds a small but realistic resume .docx in memory for the tests (no real candidate data).
import { writeZip } from "../src/lib/zip.js";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';

const run = (text, { bold = false, size = 20 } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold ? "<w:b/><w:bCs/>" : '<w:b w:val="false"/>'}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

export const P = (runs, { bullet = false, id = "1A2B3C4D" } = {}) =>
  `<w:p w14:paraId="${id}"><w:pPr>${bullet ? '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}<w:spacing w:after="60"/></w:pPr>${runs}</w:p>`;

const cell = (text, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${P(run(text, { bold, size: 19 }))}</w:tc>`;

export function buildDocumentXml({
  bullets = [
    "Administered Windows Server 2016 and 2019 systems for the agency, including builds, upgrades and patching with WSUS.",
    "Managed Active Directory users, groups and Group Policy Objects for statewide field offices.",
    "Supported VMware ESXi hosts and virtual machine provisioning for production workloads.",
  ],
} = {}) {
  const body = [
    P(run("JANE SAMPLE", { bold: true, size: 32 })),
    P(run("Windows Systems Administrator")),
    P(run("Dunbar, WV | (304) 555-0100 | jane.sample@example.com | linkedin.com/in/janesample")),
    P(run("PROFESSIONAL SUMMARY", { bold: true })),
    P(run("Windows Systems Administrator with over nine years of experience supporting a statewide agency environment, covering Windows Server, Active Directory, Group Policy, virtualization and backups across many field offices.")),
    P(run("TECHNICAL SKILLS MATRIX", { bold: true })),
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="7000"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Skill Area", true)}${cell("Technologies / Tools", true)}</w:tr>` +
      `<w:tr>${cell("Operating Systems", true)}${cell("Windows Server 2019, 2016, 2012 R2; Windows 10 and 11.")}</w:tr>` +
      `<w:tr>${cell("Virtualization", true)}${cell("VMware ESXi / vSphere; Microsoft Hyper-V; virtual machine provisioning.")}</w:tr>` +
      `<w:tr>${cell("Backup & Recovery", true)}${cell("Veritas Backup Exec, Arcserve, restore testing, disaster recovery documentation.")}</w:tr>` +
      `</w:tbl>`,
    P(run("Tools: ", { bold: true }) + run("ServiceNow, SVN, Microsoft Project, Visio.")),
    P(run("PROFESSIONAL EXPERIENCE", { bold: true })),
    P(run("Optum - Client: West Virginia DHHR", { bold: true })),
    P(run("Systems Administrator", { bold: true }) + run("\tMay 2016 - October 2025")),
    ...bullets.map((b, i) => P(run(b), { bullet: true, id: `B000000${i}` })),
    P(run("EDUCATION", { bold: true })),
    P(run("Bachelor of Science in Computer Science - State University")),
    P(run("CERTIFICATIONS", { bold: true })),
    P(run("ITIL v3 Foundation"), { bullet: true, id: "C0000001" }),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
}

export async function buildDocx(opts) {
  const xml = buildDocumentXml(opts);
  return writeZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: xml },
  ]);
}
