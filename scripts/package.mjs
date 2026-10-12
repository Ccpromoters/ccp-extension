// Builds dist/ccp-extension-v<version>.zip (the file you upload to the Chrome Web Store or
// attach to a GitHub release). Uses the extension's own zip writer - no dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip } from "../src/lib/zip.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const include = ["manifest.json", "icons", "src"];
const exclude = (p) => /(^|\/)(dev|\.DS_Store|Thumbs\.db)(\/|$)/.test(p);

function walk(rel, out) {
  const abs = path.join(root, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, name), out);
  } else if (!exclude(rel)) {
    out.push({ name: rel, data: new Uint8Array(fs.readFileSync(abs)) });
  }
}

const entries = [];
for (const rel of include) walk(rel, entries);
const bytes = await writeZip(entries);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const outFile = path.join(root, "dist", `ccp-extension-v${manifest.version}.zip`);
fs.writeFileSync(outFile, bytes);
console.log(`${path.relative(root, outFile)}: ${entries.length} files, ${(bytes.length / 1024).toFixed(0)} KB`);
