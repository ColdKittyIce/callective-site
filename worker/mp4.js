/* Wrap an MP3 in an MP4 with a single still picture, so Discord (and anything else that plays og:video)
   shows a real player for a clip. No re-encoding: the MP3 frames are copied as-is (MP4 audio type 0x6B),
   and the picture is one H.264 frame that lasts the whole clip. */
import { AVCC, FRAME, STILL_W, STILL_H } from "./still.js";

const b64 = s => { const t = atob(s), o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o; };
let STILL = null; const still_ = () => STILL || (STILL = { avcc: b64(AVCC), frame: b64(FRAME) });
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };

// Find every MP3 frame (layer III). Returns {off: Int32Array, len: Int32Array, n, rate, spf, channels}.
// Written to allocate nothing per frame: a 20-minute clip has ~50,000 frames and the worker gets ~10 ms of CPU.
const SRT = new Int32Array([11025, 12000, 8000, 0, 0, 0, 0, 0, 22050, 24000, 16000, 0, 44100, 48000, 32000, 0]);
const KB1 = new Int32Array(KBPS[1]), KB2 = new Int32Array(KBPS[2]);
export function mp3Frames(b) {
  let i = 0, n = 0, rate = 0, ver0 = -1, channels = 2;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  const cap = Math.ceil(b.length / 48) + 16, off = new Int32Array(cap), len = new Int32Array(cap), L = b.length;
  const flen = j => { // frame length at j, or 0 if no valid header
    if (j + 4 > L || b[j] !== 0xff || (b[j + 1] & 0xe0) !== 0xe0) return 0;
    const b1 = b[j + 1], b2 = b[j + 2], ver = (b1 >> 3) & 3, bi = b2 >> 4, si = (b2 >> 2) & 3;
    if (ver === 1 || ((b1 >> 1) & 3) !== 1 || bi === 0 || bi === 15 || si === 3 || (ver0 >= 0 && ver !== ver0)) return 0;
    const sr = SRT[ver * 4 + si]; if (rate && sr !== rate) return 0;
    return ver === 3 ? ((144000 * KB1[bi] / sr) | 0) + ((b2 >> 1) & 1) : ((72000 * KB2[bi] / sr) | 0) + ((b2 >> 1) & 1);
  };
  while (i < L - 4 && n < cap) {
    const l = flen(i);
    if (l && (i + l >= L - 4 || flen(i + l))) {
      if (!rate) { ver0 = (b[i + 1] >> 3) & 3; rate = SRT[ver0 * 4 + ((b[i + 2] >> 2) & 3)]; channels = (b[i + 3] >> 6) === 3 ? 1 : 2; }
      if (i + l > L) break;
      off[n] = i; len[n] = l; n++; i += l;
    } else i++;
  }
  return { off, len, n, rate, spf: ver0 === 3 ? 1152 : 576, channels };
}

const u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const u16 = n => [n >>> 8 & 255, n & 255];
const str = s => [...s].map(c => c.charCodeAt(0));
// Boxes are built as Uint8Arrays; parts can be numbers, arrays of parts, or Uint8Arrays (kept as-is, no copying per byte).
function bytes(parts) {
  const chunks = []; let small = [];
  const walk = x => { if (x instanceof Uint8Array) { if (small.length) { chunks.push(Uint8Array.from(small)); small = []; } chunks.push(x); } else if (Array.isArray(x)) x.forEach(walk); else small.push(x); };
  walk(parts); if (small.length) chunks.push(Uint8Array.from(small));
  let len = 0; for (const c of chunks) len += c.length; const out = new Uint8Array(len); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; } return out;
}
function box(type, ...parts) { const body = bytes(parts), out = new Uint8Array(8 + body.length); out.set(u32(out.length)); out.set(str(type), 4); out.set(body, 8); return out; }
const full = (type, v, f, ...parts) => box(type, [v, ...u32(f).slice(1)], ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

// Build everything that goes before the audio: ftyp + moov + the mdat header + the still frame.
// The MP3 frames from `start` to `end` of the source follow unchanged, so the audio never has to be copied.
export function mp4Head(mp3) {
  const F = mp3Frames(mp3), { rate, spf, channels } = F; let n = F.n;
  if (!n) throw new Error("No MP3 audio found");
  for (let k = 1; k < n; k++) if (F.off[k] !== F.off[k - 1] + F.len[k - 1]) { n = k; break; } // stop at the first gap
  const { avcc, frame: still } = still_();
  const start = F.off[0], end = F.off[n - 1] + F.len[n - 1], audioBytes = end - start;
  const durA = n * spf, ms = Math.round(durA / rate * 1000);
  const VTS = 1000; // video timescale: the one frame lasts the whole clip
  const tkhd = (id, w, h, vol) => full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(ms), u32(0), u32(0), u16(0), u16(0), u16(vol), u16(0), MATRIX, u32(w * 65536), u32(h * 65536));
  const mdhd = (ts, d) => full("mdhd", 0, 0, u32(0), u32(0), u32(ts), u32(d), u16(0x55c4), u16(0));
  const hdlr = (t, name) => full("hdlr", 0, 0, u32(0), str(t), u32(0), u32(0), u32(0), str(name), 0);
  const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
  const sizes = new Uint8Array(n * 4); for (let k = 0, q = 0; k < n; k++, q += 4) { const v = F.len[k]; sizes[q] = v >>> 24; sizes[q + 1] = v >>> 16 & 255; sizes[q + 2] = v >>> 8 & 255; sizes[q + 3] = v & 255; }
  const oti = spf === 1152 ? 0x6B : 0x69; // MPEG-1 / MPEG-2 layer III
  const dec = [0x04, 13, oti, 0x15, 0, 0, 0, ...u32(320000), ...u32(128000)];
  const es = [0x03, 3 + dec.length + 3, 0, 1, 0, ...dec, 0x06, 1, 2];
  const build = (vOff, aOff) => {
    const vtrak = box("trak", tkhd(1, STILL_W, STILL_H, 0), box("mdia", mdhd(VTS, ms), hdlr("vide", "Callective"),
      box("minf", full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf,
        box("stbl",
          full("stsd", 0, 0, u32(1), box("avc1", u32(0), u16(0), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(STILL_W), u16(STILL_H),
            u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), box("avcC", avcc))),
          full("stts", 0, 0, u32(1), u32(1), u32(ms)),
          full("stss", 0, 0, u32(1), u32(1)),
          full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
          full("stsz", 0, 0, u32(still.length), u32(1)),
          full("stco", 0, 0, u32(1), u32(vOff))))));
    const atrak = box("trak", tkhd(2, 0, 0, 0x0100), box("mdia", mdhd(rate, durA), hdlr("soun", "Callective"),
      box("minf", full("smhd", 0, 0, u16(0), u16(0)), dinf,
        box("stbl",
          full("stsd", 0, 0, u32(1), box("mp4a", u32(0), u16(0), u16(1), u32(0), u32(0), u16(channels), u16(16), u16(0), u16(0), u32(rate * 65536), full("esds", 0, 0, es))),
          full("stts", 0, 0, u32(1), u32(n), u32(spf)),
          full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
          full("stsz", 0, 0, u32(0), u32(n), sizes),
          full("stco", 0, 0, u32(1), u32(aOff))))));
    const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(3));
    return box("moov", mvhd, vtrak, atrak);
  };
  const ftyp = box("ftyp", str("isom"), u32(512), str("isom"), str("iso2"), str("avc1"), str("mp41"));
  const moovLen = build(0, 0).length, vOff = ftyp.length + moovLen + 8, aOff = vOff + still.length;
  const head = bytes([ftyp, build(vOff, aOff), u32(8 + still.length + audioBytes), str("mdat"), still]);
  return { head, start, end, sec: durA / rate };
}

// Whole file in one buffer (used for testing).
export function mp3ToMp4(mp3) {
  const { head, start, end, sec } = mp4Head(mp3);
  const out = new Uint8Array(head.length + end - start); out.set(head); out.set(mp3.subarray(start, end), head.length);
  return { mp4: out, sec };
}
