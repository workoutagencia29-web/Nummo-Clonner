/**
 * QR Code do PIX gerado na própria página a partir do código "copia e cola",
 * quando o gateway não manda a imagem (ou manda num formato que não aceitamos).
 * Sem dependências e sem desestruturação (alvo Safari 13).
 *
 * Codificação em bytes (UTF-8), correção de erro nível M (até ~15% do código
 * pode estar sujo ou amassado), versão automática (1 a 40) e a máscara com a
 * menor penalidade — o algoritmo da norma ISO/IEC 18004, no mesmo desenho do
 * gerador de referência de Project Nayuki (MIT).
 */

/** Códigos de correção por bloco (nível M), por versão (índice 0 não existe). */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
/** Blocos de correção (nível M), por versão. */
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
  35, 37, 38, 40, 43, 45, 47, 49,
];
/** Bits do nível M no formato (L=1, M=0, Q=3, H=2). */
const ECL_BITS = 0;

/** Texto → bytes UTF-8. */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < degree - 1; i++) out.push(0);
  out.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < out.length) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < divisor.length; i++) out.push(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ (out.shift() as number);
    out.push(0);
    for (let j = 0; j < divisor.length; j++) out[j] ^= gfMul(divisor[j], factor);
  }
  return out;
}

/** Dados + correção, em blocos intercalados (como a norma pede). */
function withEcc(data: number[], ver: number): number[] {
  const blocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const block = dat.concat(rsRemainder(dat, divisor));
    if (i < shortBlocks) block.splice(dat.length, 0, 0);
    all.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(all[j][i]);
    }
  }
  return out;
}

function alignPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Penalidade da norma (quanto menor, mais fácil de ler). */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  let dark = 0;
  const pattern = (line: boolean[], i: number) => {
    // 1011101 com 4 claros de um lado (claro-escuro como os cantos do QR).
    const core = [true, false, true, true, true, false, true];
    for (let k = 0; k < 7; k++) if (line[i + k] !== core[k]) return false;
    let before = true;
    let after = true;
    for (let k = 1; k <= 4; k++) {
      if (line[i - k] === true) before = false;
      if (line[i + 6 + k] === true) after = false;
    }
    return before || after;
  };
  for (let dir = 0; dir < 2; dir++) {
    for (let a = 0; a < size; a++) {
      const line: boolean[] = [];
      for (let b = 0; b < size; b++) line.push(dir === 0 ? m[a][b] : m[b][a]);
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let b = 0; b + 7 <= size; b++) if (pattern(line, b)) score += 40;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (y + 1 < size && x + 1 < size) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
  }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

function masked(mask: number, x: number, y: number): boolean {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  if (mask === 4) return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
  if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
  if (mask === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
  return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
}

/**
 * Matriz do QR Code (true = módulo escuro), sem a margem. null = texto grande
 * demais (passa da versão 40) — o PIX nunca chega perto disso.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = utf8Bytes(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    const count = ver < 10 ? 8 : 16;
    if (4 + count + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) return null;
  const capacity = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  const codewords = withEcc(data, ver);

  const size = ver * 4 + 17;
  const mods: boolean[][] = [];
  const fn: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    mods.push([]);
    fn.push([]);
    for (let x = 0; x < size; x++) {
      mods[y].push(false);
      fn[y].push(false);
    }
  }
  const set = (x: number, y: number, dark: boolean) => {
    mods[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignPositions(ver, size);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const format = (mask: number) => {
    const value = (ECL_BITS << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((value << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && k < codewords.length * 8) {
          mods[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
          k++;
        }
      }
    }
  }
  let best: boolean[][] | null = null;
  let bestScore = 0;
  for (let mask = 0; mask < 8; mask++) {
    format(mask);
    const copy: boolean[][] = [];
    for (let y = 0; y < size; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < size; x++) row.push(fn[y][x] ? mods[y][x] : mods[y][x] !== masked(mask, x, y));
      copy.push(row);
    }
    const score = penalty(copy);
    if (!best || score < bestScore) {
      best = copy;
      bestScore = score;
    }
  }
  return best;
}

/**
 * QR Code em SVG (um caminho só, com 4 módulos de margem branca): nítido em
 * qualquer tamanho e leve. null = texto grande demais.
 */
export function qrSvg(text: string, label: string): string | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const size = m.length + 8;
  let d = "";
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (!m[y][x]) continue;
      let run = 1;
      while (x + run < m.length && m[y][x + run]) run++;
      d += `M${x + 4} ${y + 4}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const safe = label.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${safe}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
