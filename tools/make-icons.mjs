/**
 * PWA 아이콘 생성 — `npm run icons`
 *
 * **의존성을 쓰지 않고 PNG 를 직접 쓴다.** sharp 같은 이미지 라이브러리는 네이티브 빌드가
 * 붙고(설치 40MB+), 아이콘 4장을 만드는 데 그 비용을 낼 이유가 없다. PNG 는
 * `zlib.deflate` + CRC32 만 있으면 만들 수 있고 Node 에 둘 다 있다.
 *
 * 그림: 계단 3칸 + 그 위에 선 캐릭터. 192px 에서도 "계단을 오르는 아이"로 읽히도록
 * 요소를 3개로 줄였다 — 작은 아이콘에 디테일을 넣으면 뭉개져서 아무것도 안 보인다.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public');

/* ── PNG 인코더 ── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 픽셀 버퍼 → PNG */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10~12: compression, filter, interlace = 0

  // 스캔라인마다 필터 바이트(0 = None)를 앞에 붙인다
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 그리기 ── */

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4);
  }

  /** 0~1 좌표계로 받는다 — 크기가 달라도 같은 그림이 나온다 */
  px(x, y) {
    return Math.round(x * this.size);
  }

  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    if (a === 255) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
      return;
    }
    // 알파 합성 (안티에일리어싱용)
    const src = a / 255;
    const dst = this.data[i + 3] / 255;
    const out = src + dst * (1 - src);
    this.data[i] = Math.round((r * src + this.data[i] * dst * (1 - src)) / out);
    this.data[i + 1] = Math.round((g * src + this.data[i + 1] * dst * (1 - src)) / out);
    this.data[i + 2] = Math.round((b * src + this.data[i + 2] * dst * (1 - src)) / out);
    this.data[i + 3] = Math.round(out * 255);
  }

  /** 위에서 아래로 색이 변하는 배경 */
  gradient(top, bottom) {
    for (let y = 0; y < this.size; y++) {
      const t = y / (this.size - 1);
      const color = [
        Math.round(top[0] + (bottom[0] - top[0]) * t),
        Math.round(top[1] + (bottom[1] - top[1]) * t),
        Math.round(top[2] + (bottom[2] - top[2]) * t),
      ];
      for (let x = 0; x < this.size; x++) this.set(x, y, color);
    }
  }

  rect(x, y, w, h, color) {
    const x0 = this.px(x);
    const y0 = this.px(y);
    const x1 = this.px(x + w);
    const y1 = this.px(y + h);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.set(px, py, color);
  }

  /** 가장자리를 부드럽게 — 아이콘은 크게도 쓰이므로 계단 현상이 보인다 */
  circle(cx, cy, r, color) {
    const c = this.px(cx);
    const cy2 = this.px(cy);
    const rr = r * this.size;
    const span = Math.ceil(rr) + 2;
    for (let py = cy2 - span; py <= cy2 + span; py++) {
      for (let px = c - span; px <= c + span; px++) {
        const d = Math.hypot(px + 0.5 - c, py + 0.5 - cy2);
        if (d <= rr - 0.5) this.set(px, py, color);
        else if (d < rr + 0.5) this.set(px, py, [...color.slice(0, 3), Math.round((rr + 0.5 - d) * 255)]);
      }
    }
  }
}

/* ── 아이콘 ── */

const BG_TOP = [27, 33, 69]; // #1b2145 — 밤의 성 하늘
const BG_BOTTOM = [16, 21, 31]; // #10151f — 게임 배경
const DIRT = [138, 90, 59];
const GRASS = [76, 175, 106];
const SKIN = [246, 231, 200];
const SHIRT = [77, 214, 161];
const GOLD = [255, 210, 74];

/**
 * @param size 픽셀 크기
 * @param inset 마스커블 아이콘은 원형으로 잘리므로 그림을 가운데로 모은다
 */
function drawIcon(size, inset = 0) {
  const c = new Canvas(size);
  c.gradient(BG_TOP, BG_BOTTOM);

  // 0~1 좌표를 inset 만큼 안쪽으로 축소해 배치한다
  const at = (x, y) => [inset + x * (1 - inset * 2), inset + y * (1 - inset * 2)];
  const scale = 1 - inset * 2;

  /* 계단 3칸 — 왼쪽 아래에서 오른쪽 위로.
     캐릭터 좌표는 **맨 위 칸의 실제 사각형에서 계산한다.** 처음에 0~1 좌표로 눈대중
     배치했더니 몸이 계단 위에 서지 않고 머리와 겹쳤다. */
  const step = 0.235 * scale;
  const blocks = [
    [0.08, 0.64],
    [0.34, 0.47],
    [0.6, 0.3],
  ];
  let top = null;
  for (const [bx, by] of blocks) {
    const [x, y] = at(bx, by);
    c.rect(x, y, step, step, DIRT);
    // 풀 상단 — 게임의 계단 블록과 같은 실루엣
    c.rect(x, y, step, step * 0.26, GRASS);
    top = { x, y, w: step };
  }

  // 캐릭터 — 맨 위 칸 **위에** 선다 (발이 풀 상단에 닿는다)
  const bodyW = step * 0.44;
  const bodyH = step * 0.5;
  const headR = step * 0.29;
  const cx = top.x + top.w / 2;
  c.rect(cx - bodyW / 2, top.y - bodyH, bodyW, bodyH, SHIRT);
  c.circle(cx, top.y - bodyH - headR * 0.9, headR, SKIN);

  // 가운데 칸 위의 금색 크리스탈 — 게임의 수집 기믹이다
  const mid = at(blocks[1][0], blocks[1][1]);
  c.circle(mid[0] + step / 2, mid[1] - step * 0.16, step * 0.15, GOLD);

  return encodePng(size, size, c.data);
}

mkdirSync(OUT_DIR, { recursive: true });

const files = [
  // 마스커블은 원형으로 잘리므로 안쪽으로 모은다 (안전 영역 80%)
  ['icon-512.png', drawIcon(512, 0.1)],
  ['icon-192.png', drawIcon(192, 0.1)],
  // iOS 는 자체적으로 모서리를 깎으므로 여백을 적게 둔다
  ['apple-touch-icon.png', drawIcon(180, 0.04)],
];

for (const [name, buf] of files) {
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`${name.padEnd(22)} ${(buf.length / 1024).toFixed(1)}KB`);
}
console.log('\npublic/ 에 아이콘 3장을 썼다. vite-plugin-pwa 가 manifest 에 넣는다.');
