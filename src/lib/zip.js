// Minimal ZIP reader/writer for .docx files. No dependencies: uses the browser's
// (and Node 18+'s) CompressionStream / DecompressionStream for deflate.
//
// readZip(bytes)  -> Map<name, Entry>   Entry = { name, method, crc, compSize, size, compData, data() }
// writeZip(entries) -> Uint8Array        entries: iterable of Entry-like objects (compData kept as-is
//                                        when present, otherwise `data` is compressed)
//
// Only the subset of the format that Word / docx-js / python-docx produce is handled:
// methods 0 (store) and 8 (deflate), no ZIP64, no encryption.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export const deflateRaw = (bytes) => pipe(bytes, new CompressionStream("deflate-raw"));
export const inflateRaw = (bytes) => pipe(bytes, new DecompressionStream("deflate-raw"));

export class ZipError extends Error {}

export async function readZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of central directory: scan backwards (comment can be up to 64 KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a ZIP/DOCX file (no end-of-central-directory record)");
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError("Corrupt central directory");
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (dv.getUint32(localOffset, true) !== SIG_LOCAL) throw new ZipError(`Corrupt local header for ${name}`);
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compData = bytes.slice(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression method ${method} for ${name}`);

    const entry = {
      name, method, time, date, crc, compSize, size, compData,
      _data: null,
      async data() {
        if (!this._data) this._data = this.method === 0 ? this.compData : await inflateRaw(this.compData);
        return this._data;
      },
    };
    entries.set(name, entry);
  }
  return entries;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Build a zip. Each entry needs `name` and either `compData` (+ method, crc, size) or `data`. */
export async function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = dosDateTime();

  for (const e of entries) {
    let { method, crc, size, compData, time, date } = e;
    if (!compData) {
      const data = e.data instanceof Uint8Array ? e.data : enc.encode(e.data);
      size = data.length;
      crc = crc32(data);
      method = data.length < 64 ? 0 : 8;
      compData = method === 8 ? await deflateRaw(data) : data;
    }
    time ??= now.time;
    date ??= now.date;
    const nameBytes = enc.encode(e.name);
    const flags = /^[\x00-\x7f]*$/.test(e.name) ? 0 : 0x800;

    const local = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, SIG_LOCAL, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, flags, true);
    ldv.setUint16(8, method, true);
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, date, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, compData.length, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, SIG_CENTRAL, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, flags, true);
    cdv.setUint16(10, method, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, compData.length, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    parts.push(local, compData);
    central.push(cd);
    offset += local.length + compData.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, SIG_EOCD, true);
  edv.setUint16(8, central.length, true);
  edv.setUint16(10, central.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...parts, ...central, eocd]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

export const bytesToText = (bytes) => dec.decode(bytes);
export const textToBytes = (text) => enc.encode(text);
