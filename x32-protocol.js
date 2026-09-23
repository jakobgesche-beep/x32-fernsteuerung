// Minimaler OSC-Codec + X32-spezifische Wertumrechnungen.
// Quelle: "UNOFFICIAL X32/M32 OSC REMOTE PROTOCOL" von Patrick-Gilles Maillot.

function oscString(str) {
  const strBuf = Buffer.from(str + "\0", "utf8");
  const padded = Math.ceil(strBuf.length / 4) * 4;
  return Buffer.concat([strBuf, Buffer.alloc(padded - strBuf.length)]);
}

function encodeMessage(address, args = []) {
  const addrBuf = oscString(address);
  const typeTag = "," + args.map((a) => a.type).join("");
  const typeBuf = oscString(typeTag);
  const argBufs = args.map((a) => {
    if (a.type === "f") { const b = Buffer.alloc(4); b.writeFloatBE(a.value, 0); return b; }
    if (a.type === "i") { const b = Buffer.alloc(4); b.writeInt32BE(a.value, 0); return b; }
    if (a.type === "s") return oscString(a.value);
    throw new Error("Nicht unterstützter OSC-Argumenttyp: " + a.type);
  });
  return Buffer.concat([addrBuf, typeBuf, ...argBufs]);
}

function readOscString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString("utf8", offset, end);
  const next = offset + Math.ceil((end - offset + 1) / 4) * 4;
  return { str, next };
}

function decodeMessage(buf) {
  const { str: address, next: n1 } = readOscString(buf, 0);
  const args = [];
  let offset = n1;
  if (buf[offset] === 0x2c /* ',' */) {
    const { str: typeTag, next: n2 } = readOscString(buf, offset);
    offset = n2;
    for (const t of typeTag.slice(1).split("")) {
      if (t === "f") { args.push({ type: "f", value: buf.readFloatBE(offset) }); offset += 4; }
      else if (t === "i") { args.push({ type: "i", value: buf.readInt32BE(offset) }); offset += 4; }
      else if (t === "s") { const r = readOscString(buf, offset); args.push({ type: "s", value: r.str }); offset = r.next; }
      else if (t === "b") {
        const len = buf.readInt32BE(offset); offset += 4;
        const data = buf.slice(offset, offset + len);
        offset += Math.ceil(len / 4) * 4;
        args.push({ type: "b", value: data });
      } else break;
    }
  }
  return { address, args };
}

// Meter-Blob: <int32 BE: Byte-Länge><int32 LE: Anzahl Floats><float32 LE>...
function parseMeterBlob(blob) {
  const count = blob.readInt32LE(4);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = blob.readFloatLE(8 + i * 4);
  return values;
}

// "level"-Typ (Fader): 4-stufige Pseudo-Log-Kurve, siehe Anhang der Spec.
function faderToDb(f) {
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  if (f > 0) return f * 480 - 90;
  return -90;
}
function dbToFader(db) {
  if (db <= -90) return 0;
  if (db >= 10) return 1;
  if (db >= -10) return (db + 30) / 40;
  if (db >= -30) return (db + 50) / 80;
  if (db >= -60) return (db + 70) / 160;
  return (db + 90) / 480;
}

// "linf"-Typ: linear zwischen min und max.
function linfToActual(norm, min, max) { return min + norm * (max - min); }
function actualToLinf(actual, min, max) { return (actual - min) / (max - min); }

// "logf"-Typ: logarithmisch zwischen min und max (z.B. EQ-Frequenz, Q).
function logfToActual(norm, min, max) { return min * Math.pow(max / min, norm); }
function actualToLogf(actual, min, max) { return Math.log(actual / min) / Math.log(max / min); }

const EQ_TYPES = ["LCut", "LShv", "PEQ", "VEQ", "HShv", "HCut"];
const DYN_RATIOS = [1.1, 1.3, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10, 20, 100];

module.exports = {
  encodeMessage, decodeMessage, parseMeterBlob,
  faderToDb, dbToFader, linfToActual, actualToLinf, logfToActual, actualToLogf,
  EQ_TYPES, DYN_RATIOS,
};
