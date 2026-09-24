// OSC-Codec für das X32 (UDP). Reines JavaScript auf Uint8Array-Basis, damit derselbe
// Code im Hauptprozess (Node) und in Tests (Browser) läuft.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.X32OSC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function pad4(n) { return (n + 3) & ~3; }

  function encodeString(str) {
    const bytes = encoder.encode(str);
    const out = new Uint8Array(pad4(bytes.length + 1));
    out.set(bytes);
    return out;
  }

  function encodeMessage(address, args) {
    args = args || [];
    const parts = [encodeString(address), encodeString("," + args.map((a) => a.type).join(""))];
    for (const a of args) {
      if (a.type === "f" || a.type === "i") {
        const b = new Uint8Array(4);
        const dv = new DataView(b.buffer);
        if (a.type === "f") dv.setFloat32(0, a.value, false); else dv.setInt32(0, a.value, false);
        parts.push(b);
      } else if (a.type === "s") {
        parts.push(encodeString(a.value));
      } else if (a.type === "b") {
        const data = a.value;
        const b = new Uint8Array(4 + pad4(data.length));
        new DataView(b.buffer).setInt32(0, data.length, false);
        b.set(data, 4);
        parts.push(b);
      } else {
        throw new Error("Nicht unterstützter OSC-Typ: " + a.type);
      }
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  function readString(u8, offset) {
    let end = offset;
    while (end < u8.length && u8[end] !== 0) end++;
    return { str: decoder.decode(u8.subarray(offset, end)), next: offset + pad4(end - offset + 1) };
  }

  function decodeMessage(u8) {
    const first = readString(u8, 0);
    const address = first.str;
    const args = [];
    let offset = first.next;
    if (offset < u8.length && u8[offset] === 0x2c) {
      const tags = readString(u8, offset);
      offset = tags.next;
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      for (const t of tags.str.slice(1)) {
        if (t === "f") { args.push({ type: "f", value: dv.getFloat32(offset, false) }); offset += 4; }
        else if (t === "i") { args.push({ type: "i", value: dv.getInt32(offset, false) }); offset += 4; }
        else if (t === "s") { const s = readString(u8, offset); args.push({ type: "s", value: s.str }); offset = s.next; }
        else if (t === "b") {
          const len = dv.getInt32(offset, false);
          args.push({ type: "b", value: u8.subarray(offset + 4, offset + 4 + len) });
          offset += 4 + pad4(len);
        } else break;
      }
    }
    return { address, args };
  }

  // Meter-Blob-Inhalt (ohne die OSC-Längenangabe, die decodeMessage schon entfernt):
  // <int32 LE Anzahl><float32 LE>... (siehe Hex-Beispiel /meters/6 in der Spezifikation)
  function parseMeterBlob(blob) {
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const count = Math.max(0, Math.min(dv.getInt32(0, true), Math.floor((blob.byteLength - 4) / 4)));
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = dv.getFloat32(4 + i * 4, true);
    return values;
  }

  function buildMeterBlob(floats) {
    const b = new Uint8Array(4 + floats.length * 4);
    const dv = new DataView(b.buffer);
    dv.setInt32(0, floats.length, true);
    for (let i = 0; i < floats.length; i++) dv.setFloat32(4 + i * 4, floats[i], true);
    return b;
  }

  return { encodeMessage, decodeMessage, parseMeterBlob, buildMeterBlob };
});
