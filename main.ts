// The World in One Day — Thursday 19 November 2026.
// A large-card, precise front page: 15 stories, all first reported on
// 19 November 2026, each date-checked. Drawn entirely in code with a
// hand-built single-stroke vector font (no external assets, no network).
// Writes /output/entry.png (1024x1024, <= 1 MiB), deterministically.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---- palette: broadsheet paper, navy ink, red + teal accents ----
const PAPER: RGB = [247, 243, 234];
const INK: RGB = [20, 33, 61];
const INK_SOFT: RGB = [52, 64, 92];
const RED: RGB = [178, 34, 24];
const TEAL: RGB = [14, 107, 107];
const GOLD: RGB = [176, 124, 0];
const NAVY_BG: RGB = [20, 33, 61];
const CARD: RGB = [255, 255, 255];
const RULE: RGB = [20, 33, 61];
const GREY_LINE: RGB = [198, 190, 175];

type RGB = [number, number, number];

// ---- pixel canvas (RGB, row-major) ----
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  buf[i * 3] = PAPER[0]; buf[i * 3 + 1] = PAPER[1]; buf[i * 3 + 2] = PAPER[2];
}
function px(x: number, y: number, c: RGB): void {
  const ix = Math.round(x); const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 3;
  buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
}
function disc(cx: number, cy: number, r: number, c: RGB): void {
  const rr = Math.max(0.5, r);
  const x0 = Math.floor(cx - rr); const x1 = Math.ceil(cx + rr);
  const y0 = Math.floor(cy - rr); const y1 = Math.ceil(cy + rr);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= rr * rr) px(x, y, c);
  }
}
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x)); const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w)); const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    const o = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      const p = o + (xx - x0) * 3;
      buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2];
    }
  }
}
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0; const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.4, w * 0.35)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c);
  }
}
function polyFill(points: Array<[number, number]>, c: RGB): void {
  // Even-odd scanline fill for a simple polygon.
  let minY = Infinity; let maxY = -Infinity;
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i]; const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y + 0.5 - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])); const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) px(x, y, c);
    }
  }
}

// ---- PNG encoder (stdlib zlib; tries filter None and Up, keeps smaller) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = W * 3;
  let best: Buffer | null = null;
  for (const filter of [0, 2]) {
    const raw = Buffer.alloc(H * (stride + 1));
    for (let y = 0; y < H; y++) {
      const rowOff = y * (stride + 1);
      raw[rowOff] = filter;
      const src = y * stride;
      for (let x = 0; x < stride; x++) {
        const v = buf[src + x];
        raw[rowOff + 1 + x] = filter === 2 ? (v - (y > 0 ? buf[src - stride + x] : 0) + 256) & 0xff : v;
      }
    }
    const comp = deflateSync(raw, { level: 9 });
    if (!best || comp.length < best.length) best = comp;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', best!), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- hand-built single-stroke vector font ----
// Grid: x 0..8, y 0 (top) .. 10 (baseline), descenders to 13.
// Each glyph: [advance (grid units), "x,y x,y|x,y x,y" strokes].
// A one-point stroke is a dot.
type Glyph = [number, string];
const FONT: Record<string, Glyph> = {
  A: [9, '0,10 4,0 8,10|2,6 6,6'],
  B: [9, '0,0 0,10 6,10 8,8 8,6 5,5|5,5 8,4 8,2 6,0 0,0'],
  C: [9, '8,2 6,0 2,0 0,2 0,8 2,10 6,10 8,8'],
  D: [9, '0,0 0,10 5,10 8,8 8,2 5,0 0,0'],
  E: [9, '8,0 0,0 0,10 8,10|0,5 6,5'],
  F: [9, '8,0 0,0 0,10|0,5 6,5'],
  G: [9, '8,2 6,0 2,0 0,2 0,8 2,10 6,10 8,8 8,5 5,5'],
  H: [9, '0,0 0,10|8,0 8,10|0,5 8,5'],
  I: [9, '4,0 4,10|2,0 6,0|2,10 6,10'],
  J: [9, '8,0 8,8 6,10 2,10 0,8'],
  K: [9, '0,0 0,10|8,0 0,5 8,10'],
  L: [9, '0,0 0,10 8,10'],
  M: [10, '0,10 0,0 4,6 8,0 8,10'],
  N: [9, '0,10 0,0 8,10 8,0'],
  O: [9, '2,0 6,0 8,2 8,8 6,10 2,10 0,8 0,2 2,0'],
  P: [9, '0,10 0,0 6,0 8,2 8,4 6,6 0,6'],
  Q: [9, '2,0 6,0 8,2 8,8 6,10 2,10 0,8 0,2 2,0|5,7 8,10'],
  R: [9, '0,10 0,0 6,0 8,2 8,4 6,6 0,6|5,6 8,10'],
  S: [9, '7,1 5,0 2,0 1,1 0,3 1,5 3,5 6,6 7,7 8,8 7,10 5,10 2,10 1,9'],
  T: [9, '0,0 8,0|4,0 4,10'],
  U: [9, '0,0 0,8 2,10 6,10 8,8 8,0'],
  V: [9, '0,0 4,10 8,0'],
  W: [10, '0,0 2,10 4,5 6,10 8,0'],
  X: [9, '0,0 8,10|8,0 0,10'],
  Y: [9, '0,0 4,5 8,0|4,5 4,10'],
  Z: [9, '0,0 8,0 0,10 8,10'],
  a: [9, '8,4 8,10 2,10 0,8 0,6 2,4 5,4 7,5'],
  b: [9, '0,0 0,10 6,10 8,8 8,6 6,4 0,4'],
  c: [9, '7,5 5,4 2,4 0,6 0,8 2,10 5,10 7,9'],
  d: [9, '8,0 8,10 2,10 0,8 0,6 2,4 8,4'],
  e: [9, '8,7 0,7 0,8 2,10 6,10 8,8 8,6 6,4 2,4 0,6'],
  f: [6, '5,0 2,0 1,1 0,3 0,10|0,4 5,4'],
  g: [9, '0,6 2,4 6,4 8,6 8,8 6,10 2,10 0,8|8,8 8,12 6,13 2,13 0,11'],
  h: [9, '0,0 0,10|0,4 2,4 6,4 8,6 8,10'],
  i: [5, '2,4 2,10|2,1 2,1'],
  j: [5, '3,4 3,11 2,13 1,13|3,1 3,1'],
  k: [9, '0,0 0,10|7,4 0,7 7,10'],
  l: [5, '2,0 2,10'],
  m: [10, '0,10 0,4 2,4 4,5 4,10|4,4 6,4 8,6 8,10'],
  n: [9, '0,10 0,4 2,4 6,4 8,6 8,10'],
  o: [9, '2,4 6,4 8,6 8,8 6,10 2,10 0,8 0,6 2,4'],
  p: [9, '0,4 0,13|0,4 6,4 8,6 8,8 6,10 2,10 0,10'],
  q: [9, '8,4 8,13|8,4 2,4 0,6 0,8 2,10 8,10'],
  r: [6, '0,10 0,4 2,4 5,4 7,5'],
  s: [9, '7,4 5,3 2,3 0,5 2,7 5,7 7,8 7,9 6,10 3,10 1,9'],
  t: [6, '3,0 3,9 4,10 6,10|0,4 5,4'],
  u: [9, '0,4 0,8 2,10 6,10 8,8 8,4'],
  v: [9, '0,4 4,10 8,4'],
  w: [10, '0,4 2,10 4,6 6,10 8,4'],
  x: [9, '0,4 8,10|8,4 0,10'],
  y: [9, '0,4 4,10 8,4|4,10 3,13 1,13'],
  z: [9, '0,4 8,4 0,10 8,10'],
  '0': [9, '2,0 6,0 8,2 8,8 6,10 2,10 0,8 0,2 2,0'],
  '1': [9, '3,1 4,0 4,10|1,10 7,10'],
  '2': [9, '1,2 2,0 6,0 8,2 8,4 0,10 8,10'],
  '3': [9, '2,1 4,0 6,0 8,2 8,4 5,5|5,5 8,6 8,8 6,10 3,10 1,9'],
  '4': [9, '6,0 6,10|7,7 0,7 5,0'],
  '5': [9, '8,0 0,0 0,5 5,5 8,6 8,8 6,10 2,10 0,9'],
  '6': [9, '7,1 5,0 2,1 0,3 0,8 2,10 6,10 8,8 8,6 6,5 2,5 0,7'],
  '7': [9, '0,0 8,0 4,10'],
  '8': [9, '2,0 6,0 8,2 8,4 6,5 2,5 0,4 0,2 2,0|2,5 6,5 8,7 8,9 6,10 2,10 0,8 0,6 2,5'],
  '9': [9, '8,10 8,1 6,0 2,0 0,2 0,5 2,6 6,6 8,5'],
  '.': [4.5, '2,10 2,10'],
  ',': [4.5, '2,9 2,11 1,13'],
  ':': [4.5, '2,4 2,4|2,9 2,9'],
  ';': [4.5, '2,4 2,4|2,9 2,11 1,13'],
  "'": [4.5, '2,0 1,3'],
  '"': [7, '2,0 1,3|4,0 3,3'],
  '!': [5, '2,0 2,7|2,10 2,10'],
  '?': [9, '2,1 4,0 6,0 8,2 8,4 6,5 4,6 4,7|4,10 4,10'],
  '-': [6, '1,5 7,5'],
  '\u2013': [9, '0,5 8,5'],
  '\u2014': [11, '0,5 8,5'],
  '(': [5.5, '3,0 1,2 1,8 3,10'],
  ')': [5.5, '2,0 4,2 4,8 2,10'],
  '/': [6, '1,10 7,0'],
  '%': [11, '8,10 0,0|2,2 2,2|6,8 6,8'],
  '&': [9, '6,0 4,1 2,3 2,5 4,6 7,6 8,8 6,10 2,10 1,9|2,3 7,8'],
  $: [9, '4,-1 4,11|7,2 5,0 2,0 1,2 1,4 3,5 6,5 7,7 7,9 5,10 2,10 1,8'],
  '\u00b7': [5, '2,6 2,6'],
  '\u2022': [5, '2,5 2,5'],
  '\u2713': [9, '1,6 3,9 7,1'],
  '=': [9, '1,3 7,3|1,7 7,7'],
  '+': [9, '4,1 4,9|1,5 7,5'],
  '*': [9, '4,0 4,10|0,3 8,7|8,3 0,7'],
  '\u00d7': [9, '1,2 7,8|7,2 1,8'],
  ' ': [4.5, ''],
};
const FALLBACK: Glyph = [9, '0,0 8,0 8,10 0,10 0,0'];

// ---- text: measure + draw + wrap (size = cap height in px) ----
function glyphOf(ch: string): Glyph {
  return FONT[ch] ?? FALLBACK;
}
function textWidth(s: string, size: number): number {
  const u = size / 10;
  let w = 0;
  for (const ch of s) w += glyphOf(ch)[0] * u;
  return w;
}
function drawText(s: string, x: number, yTop: number, size: number, c: RGB, bold = false): number {
  // yTop = top of cap height. Returns width drawn.
  const u = size / 10;
  const sw = Math.max(1, Math.round(size * (bold ? 0.17 : 0.13)));
  let cx = x;
  for (const ch of s) {
    const [adv, strokes] = glyphOf(ch);
    if (strokes) {
      for (const stroke of strokes.split('|')) {
        const pts = stroke.trim().split(/\s+/).map((p) => {
          const [gx, gy] = p.split(',').map(Number);
          return [cx + gx * u, yTop + gy * u] as [number, number];
        });
        if (pts.length === 1) {
          disc(pts[0][0], pts[0][1], sw / 2 + 0.4, c);
        } else {
          for (let i = 0; i + 1 < pts.length; i++) {
            thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], sw, c);
          }
        }
      }
    }
    cx += adv * u;
  }
  return cx - x;
}
function drawTextCentered(s: string, cx: number, yTop: number, size: number, c: RGB, bold = false): void {
  drawText(s, cx - textWidth(s, size) / 2, yTop, size, c, bold);
}
function wrapText(s: string, size: number, maxW: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (textWidth(trial, size) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawLines(lines: string[], x: number, yTop: number, size: number, lh: number, c: RGB, bold = false): number {
  let y = yTop;
  for (const ln of lines) { drawText(ln, x, y, size, c, bold); y += lh; }
  return y;
}

// ---- story data: 15 stories, each first reported Thu 19 Nov 2026 ----
interface Brief { kicker: string; color: RGB; head: string; deck: string; tag: string; }
const BRIEFS: Brief[] = [
  { kicker: 'UKRAINE', color: TEAL, head: 'Kerch Bridge rail halted in third strike in four days', deck: 'Ukraine hits the bridge to Crimea again; rail traffic stops.', tag: '\u2713 19 NOV \u00b7 AP' },
  { kicker: 'THE GULF', color: RED, head: 'Iran widens attacks to Kuwait and Bahrain', deck: 'Tehran strikes Gulf neighbours after US hits on Qeshm Island.', tag: '\u2713 19 NOV \u00b7 WSJ' },
  { kicker: 'GAZA', color: RED, head: 'Israeli tanks push past ceasefire line at Nuseirat', deck: 'Rare ground move into central Gaza draws a violation charge.', tag: '\u2713 19 NOV \u00b7 AP' },
  { kicker: 'RIYADH', color: GOLD, head: 'Houthi missile damages Saudi wealth fund tower', deck: 'Strike hits a Riyadh landmark as the Gulf conflict spreads.', tag: '\u2713 19 NOV \u00b7 WIRES' },
  { kicker: 'INDIA', color: TEAL, head: 'Cyclone Akvan: 47,000 evacuated in Odisha', deck: 'Third severe storm in a month; landfall due Friday at noon.', tag: '\u2713 19 NOV \u00b7 REUTERS' },
  { kicker: 'MARKETS', color: GOLD, head: 'Anthropic IPO raises a record $81bn', deck: 'Shares priced at $83; $1.5tn valuation as trading starts today.', tag: '\u2713 19 NOV \u00b7 REUTERS' },
  { kicker: 'WASHINGTON', color: INK, head: 'Jeffries nominated for Speaker, 251-11', deck: 'Democrats pick him to lead the House; floor vote on 3 January.', tag: '\u2713 19 NOV \u00b7 NPR' },
  { kicker: 'CLIMATE', color: TEAL, head: 'COP31 talks stall on fossil-fuel wording', deck: 'Final-stage split over "transition away" versus a phaseout.', tag: '\u2713 19 NOV \u00b7 REUTERS' },
  { kicker: 'FAITH', color: GOLD, head: 'Pew: Islam to pass Christianity by 2070', deck: 'New projections: Muslims to become the world\u2019s largest faith.', tag: '\u2713 19 NOV \u00b7 PEW' },
  { kicker: 'KOREA', color: RED, head: 'IAEA: North Korea expands uranium enrichment', deck: 'Watchdog reports more enrichment work at Yongbyon.', tag: '\u2713 19 NOV \u00b7 IAEA' },
  { kicker: 'RUSSIA', color: INK_SOFT, head: 'Military plane crash kills all 19 aboard', deck: 'Aircraft goes down; all on board dead, officials say.', tag: '\u2713 19 NOV \u00b7 WIRES' },
  { kicker: 'BANGLADESH', color: TEAL, head: 'Shutdown and arson as politics boils over', deck: 'Opposition strike; Yunus family home set ablaze in protests.', tag: '\u2713 19 NOV \u00b7 CHRONICLE' },
];

// Curly quotes render as their straight twins.
FONT['\u2019'] = FONT["'"];
FONT['\u2018'] = FONT["'"];
FONT['\u201c'] = FONT['"'];
FONT['\u201d'] = FONT['"'];

// ---- layout ----
const MX = 28;                 // side margin
const CW = W - 2 * MX;         // 968 content width
function card(x: number, y: number, w: number, h: number, accent: RGB): void {
  fillRect(x, y, w, h, CARD);
  fillRect(x, y, w, 4, accent);
  fillRect(x, y, w, 1, RULE); fillRect(x, y + h - 1, w, 1, RULE);
  fillRect(x, y, 1, h, RULE); fillRect(x + w - 1, y, 1, h, RULE);
}
function proofTag(s: string, x: number, y: number, size: number, c: RGB): void {
  drawText(s, x, y, size, c, true);
}

// ---- masthead ----
drawTextCentered('THE WORLD IN ONE DAY', W / 2, 26, 46, INK, true);
drawTextCentered('THURSDAY 19 NOVEMBER 2026', W / 2, 84, 20, RED, true);
drawTextCentered('15 stories, all first reported today \u2014 every one date-checked', W / 2, 114, 14, INK_SOFT);
fillRect(MX, 140, CW, 3, RED);
fillRect(MX, 145, CW, 1, RULE);

// ---- hero 1: Shenzhen summit (full width) ----
const H1Y = 156, H1H = 224;
card(MX, H1Y, CW, H1H, RED);
drawText('APEC \u00b7 SHENZHEN', MX + 16, H1Y + 18, 13, RED, true);
drawText('TRUMP, XI AND PUTIN', MX + 16, H1Y + 42, 34, INK, true);
drawText('MEET IN SHENZHEN', MX + 16, H1Y + 82, 34, INK, true);
const h1deck = wrapText('First three-way summit of the US, Chinese and Russian leaders, on the APEC sidelines, ends in a joint declaration on nuclear risks and energy flows.', 16, 616);
drawLines(h1deck, MX + 16, H1Y + 132, 16, 21, INK_SOFT);
proofTag('\u2713 19 NOV \u00b7 AP / DPA', MX + 16, H1Y + 200, 12, TEAL);
// art: three flags above a Shenzhen skyline
const AX = 716, AY = H1Y + 18;
function flagUS(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, CARD);
  for (let i = 0; i < 7; i++) if (i % 2 === 0) fillRect(x, y + (i * h) / 7, w, h / 7 + 1, RED);
  fillRect(x, y, w * 0.42, (h * 4) / 7, NAVY_BG);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) disc(x + 5 + c * 8, y + 4 + r * 7, 1.4, CARD);
  fillRect(x, y, w, 1, RULE); fillRect(x, y + h - 1, w, 1, RULE);
  fillRect(x, y, 1, h, RULE); fillRect(x + w - 1, y, 1, h, RULE);
}
function flagCN(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, RED);
  disc(x + 14, y + 12, 4, GOLD);
  disc(x + 28, y + 7, 2, GOLD); disc(x + 34, y + 14, 2, GOLD);
  disc(x + 32, y + 24, 2, GOLD); disc(x + 24, y + 27, 2, GOLD);
}
function flagRU(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h / 3, CARD);
  fillRect(x, y + h / 3, w, h / 3, [0, 57, 166]);
  fillRect(x, y + (2 * h) / 3, w, h / 3, RED);
  fillRect(x, y, w, 1, RULE); fillRect(x, y + h - 1, w, 1, RULE);
  fillRect(x, y, 1, h, RULE); fillRect(x + w - 1, y, 1, h, RULE);
}
flagUS(AX, AY, 74, 44); flagCN(AX + 86, AY, 74, 44); flagRU(AX + 172, AY, 74, 44);
drawText('US', AX + 26, AY + 50, 10, INK_SOFT, true);
drawText('CHINA', AX + 86 + 18, AY + 50, 10, INK_SOFT, true);
drawText('RUSSIA', AX + 172 + 14, AY + 50, 10, INK_SOFT, true);
// skyline silhouette with lit windows
const SY = H1Y + 116;
disc(AX + 210, SY + 6, 16, GOLD);
const towers: Array<[number, number, number]> = [[0, 96, 44], [52, 66, 38], [98, 116, 46], [152, 80, 40], [200, 108, 46]];
for (const [tx, th, tw] of towers) {
  fillRect(AX + tx, SY + 92 - th, tw, th, NAVY_BG);
  for (let wy = SY + 92 - th + 8; wy < SY + 84; wy += 12) {
    for (let wx = AX + tx + 7; wx < AX + tx + tw - 5; wx += 12) disc(wx, wy, 1.6, GOLD);
  }
}
fillRect(AX, SY + 92, 246, 2, NAVY_BG);
drawText('SHENZHEN', AX + 82, SY + 100, 11, INK_SOFT, true);

// ---- heroes 2 + 3 ----
const H2Y = 392, H2H = 164, H2W = 470;
function hero2(): void {
  const x = MX, y = H2Y;
  card(x, y, H2W, H2H, GOLD);
  drawText('THE HAGUE \u00b7 WORLD COURT', x + 14, y + 16, 12, RED, true);
  // scales of justice, top right
  const sx = x + H2W - 52, sy = y + 12;
  thickLine(sx + 20, sy, sx + 20, sy + 34, 2, GOLD);
  thickLine(sx + 2, sy + 6, sx + 38, sy + 6, 2, GOLD);
  thickLine(sx + 2, sy + 6, sx + 8, sy + 22, 1.6, GOLD);
  thickLine(sx + 38, sy + 6, sx + 32, sy + 22, 1.6, GOLD);
  polyFill([[sx + 1, sy + 22], [sx + 15, sy + 22], [sx + 8, sy + 30]], GOLD);
  polyFill([[sx + 25, sy + 22], [sx + 39, sy + 22], [sx + 32, sy + 30]], GOLD);
  drawText('WORLD COURT: MYANMAR', x + 14, y + 36, 21, INK, true);
  drawText('COMMITTED GENOCIDE', x + 14, y + 60, 21, INK, true);
  const d = wrapText('ICJ rules 9-6: the 2017 crackdown on the Rohingya was genocide, a first for the court. Safe return and reparations ordered.', 13, H2W - 28);
  drawLines(d, x + 14, y + 88, 13, 16, INK_SOFT);
  proofTag('\u2713 19 NOV \u00b7 UN NEWS', x + 14, y + 146, 11, TEAL);
}
function hero3(): void {
  const x = MX + H2W + 28, y = H2Y;
  card(x, y, H2W, H2H, TEAL);
  drawText('SPACE \u00b7 NASA', x + 14, y + 16, 12, TEAL, true);
  // probe + signal arcs, top right
  const sx = x + H2W - 58, sy = y + 10;
  disc(sx + 40, sy + 8, 2, GOLD); disc(sx + 24, sy + 20, 1.6, GOLD); disc(sx + 48, sy + 24, 1.6, GOLD);
  thickLine(sx + 8, sy + 26, sx + 26, sy + 16, 2, GOLD);
  polyFill([[sx + 26, sy + 10], [sx + 34, sy + 16], [sx + 26, sy + 22]], GOLD);
  disc(sx + 14, sy + 30, 3, TEAL);
  drawText('VOYAGER 1, ONE LIGHT-DAY', x + 14, y + 36, 21, INK, true);
  drawText('FROM HOME', x + 14, y + 60, 21, INK, true);
  const d = wrapText('NASA confirms the one-light-day crossing; a signal now takes 24 hours each way. Carrier heard, but data stopped on 14 Nov.', 13, H2W - 28);
  drawLines(d, x + 14, y + 88, 13, 16, INK_SOFT);
  proofTag('\u2713 19 NOV \u00b7 NASA / AP', x + 14, y + 146, 11, TEAL);
}
hero2();
hero3();

// ---- 12 brief cards: 3 columns x 4 rows, big type throughout ----
const B0Y = 568, BROW = 92, BCOLW = 312, BGAP = 16;
const BHEADS = [
  'Kerch Bridge rail halted in third strike',
  'Iran widens attacks to Kuwait, Bahrain',
  'Israeli tanks cross ceasefire line in Gaza',
  'Houthi missile hits Saudi wealth tower',
  'Cyclone Akvan: 47,000 leave Odisha coast',
  'Anthropic IPO raises a record $81bn',
  'Jeffries nominated for Speaker, 251-11',
  'COP31 talks stall on fossil-fuel wording',
  'Pew: Islam to pass Christianity by 2070',
  'IAEA: N. Korea expands uranium work',
  'Military plane crash kills all 19 aboard',
  'Shutdown and arson rock Bangladesh',
];
const BDECKS = [
  'Ukraine hits the bridge again.',
  'Tehran hits Gulf neighbours.',
  'Move at Nuseirat draws charge.',
  'Riyadh landmark damaged.',
  'Landfall due Friday noon.',
  '$83 a share; trading starts.',
  'House floor vote 3 January.',
  "Split over 'transition away'.",
  'Muslims to be largest by 2070.',
  'More work seen at Yongbyon.',
  'All on board dead.',
  'Yunus home ablaze in protests.',
];
for (let i = 0; i < 12; i++) {
  const col = i % 3; const row = Math.floor(i / 3);
  const x = MX + col * (BCOLW + BGAP);
  const y = B0Y + row * BROW;
  const b = BRIEFS[i];
  fillRect(x, y, BCOLW, BROW - 4, CARD);
  fillRect(x, y, 4, BROW - 4, b.color);
  fillRect(x, y, BCOLW, 1, GREY_LINE); fillRect(x, y + BROW - 5, BCOLW, 1, GREY_LINE);
  fillRect(x, y, 1, BROW - 4, GREY_LINE); fillRect(x + BCOLW - 1, y, 1, BROW - 4, GREY_LINE);
  drawText(b.kicker, x + 14, y + 10, 10.5, b.color, true);
  const tagW = textWidth(b.tag, 9);
  drawText(b.tag, x + BCOLW - 12 - tagW, y + 10, 9, TEAL, true);
  const hl = wrapText(BHEADS[i], 15, BCOLW - 28);
  drawLines(hl, x + 14, y + 28, 15, 19, INK, true);
  const dl = wrapText(BDECKS[i], 12, BCOLW - 28);
  drawLines(dl, x + 14, y + 28 + hl.length * 19 + 2, 12, 15, INK_SOFT);
}

// ---- footer: explicit date-check ----
fillRect(MX, 948, CW, 1, RULE);
const foot = wrapText('DATE-CHECK \u2014 Every story above was first reported on Thursday 19 November 2026. Sources: AP, Reuters, DPA, WSJ, NPR, UN News, NASA, IAEA, Pew Research. Left out on purpose: Cyclone Akvan\u2019s landfall (due Fri 20 Nov); an unverified \u2018dirty-bomb\u2019 claim Iran denies; casualty figures not yet confirmed by officials.', 11, CW);
drawLines(foot, MX, 954, 11, 13, INK_SOFT);

// ---- write entry.png (only to /output) ----
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`entry.png ${png.length} bytes, ${W}x${H}`);
