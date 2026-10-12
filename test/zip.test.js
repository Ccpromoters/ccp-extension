import { test } from "node:test";
import assert from "node:assert/strict";
import { readZip, writeZip, crc32, bytesToText } from "../src/lib/zip.js";

test("crc32 matches the known value for 'hello'", () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
});

test("zip round trip keeps names, order and content (stored and deflated)", async () => {
  const big = "lorem ipsum ".repeat(500);
  const bytes = await writeZip([
    { name: "a.txt", data: "hi" },
    { name: "dir/b.xml", data: big },
    { name: "ünïcode.txt", data: "x".repeat(100) },
  ]);
  const zip = await readZip(bytes);
  assert.deepEqual([...zip.keys()], ["a.txt", "dir/b.xml", "ünïcode.txt"]);
  assert.equal(zip.get("a.txt").method, 0);
  assert.equal(zip.get("dir/b.xml").method, 8);
  assert.equal(bytesToText(await zip.get("a.txt").data()), "hi");
  assert.equal(bytesToText(await zip.get("dir/b.xml").data()), big);
});

test("re-writing entries with their original compressed data is byte-stable", async () => {
  const first = await writeZip([{ name: "x.xml", data: "<a>" + "b".repeat(3000) + "</a>" }]);
  const zip = await readZip(first);
  const second = await writeZip([...zip.values()]);
  const again = await readZip(second);
  assert.equal(bytesToText(await again.get("x.xml").data()), bytesToText(await zip.get("x.xml").data()));
  assert.equal(again.get("x.xml").crc, zip.get("x.xml").crc);
});

test("readZip rejects non-zip input", async () => {
  await assert.rejects(readZip(new TextEncoder().encode("not a zip at all")), /Not a ZIP/);
});
