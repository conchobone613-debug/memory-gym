import { randBelow } from './random';

/*
 * 이진수 종목 — 6자리를 두 자리 숫자 이미지 하나로 바꿔 외운다. 이미지 세트를 따로 두지 않는다.
 * 채점은 세계기억력대회 방식의 줄 점수다(binaryRowScore).
 */

export type BinaryCode = 'b3' | 'b6';
export const DEFAULT_BINARY_CODE: BinaryCode = 'b3';

/** 한 칸 = 6자리 = 숫자 이미지 하나 */
export const BINARY_CELL = 6;
/** 한 줄 = 30자리 = 5칸 */
export const BINARY_ROW = 30;

export const CODE_LABEL: Record<BinaryCode, string> = {
  b3: '3자리씩 → 0–7 두 개',
  b6: '6자리 → 00–63',
};

/** 저장된 값(params.code 등)을 방식으로 읽는다. 모르는 값이면 fallback. */
export const toBinaryCode = (v: unknown, fallback: BinaryCode = DEFAULT_BINARY_CODE): BinaryCode =>
  v === 'b3' || v === 'b6' ? v : fallback;

/** 6자리 0/1 → 두 자리 숫자 이미지 키. b3 '101011' → '53', b6 '101011' → '43'. 6자리 0/1 이 아니면 null. */
export function bitsToKey(bits: string, code: BinaryCode): string | null {
  if (!/^[01]{6}$/.test(bits)) return null;
  if (code === 'b3') return `${parseInt(bits.slice(0, 3), 2)}${parseInt(bits.slice(3), 2)}`;
  return String(parseInt(bits, 2)).padStart(2, '0');
}

/** 화면 표기용 — '101011' → ['101', '011'] */
export function splitBits(bits: string, size = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += size) out.push(bits.slice(i, i + size));
  return out;
}

/** 칸 목록을 줄로 묶는다(한 줄 = 5칸). 마지막 줄은 모자랄 수 있다. */
export function cellRows<T>(cells: readonly T[], perRow = BINARY_ROW / BINARY_CELL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cells.length; i += perRow) out.push(cells.slice(i, i + perRow));
  return out;
}

/** 칸 답을 이어 붙인다 — 칸마다 size 자리로 자르고 모자라면 ' ' 로 채워 자리를 맞춘다. */
export const joinCells = (cells: readonly string[], size: number): string =>
  cells.map((c) => c.slice(0, size).padEnd(size, ' ')).join('');

export function randomBits(n: number): string[] {
  return Array.from({ length: n }, () => String(randBelow(2)));
}

export interface RowScore {
  score: number;
  /** 그 줄 만점(= 그 줄 길이) */
  max: number;
  /** 본 자리 안에서 틀린 수(빈칸 포함). 시도 안 한 줄은 0 */
  errors: number;
  /** 마지막으로 적은 줄까지 true */
  attempted: boolean;
}

/**
 * 줄 점수. expected·answered 는 비트를 이어 붙인 문자열이고 answered 의 빈 자리는 ' '.
 * 줄마다 모두 맞으면 줄 길이, 하나 틀리면(빈칸 포함) 절반(올림), 둘 이상 0.
 * 마지막으로 적은 줄은 마지막으로 적은 자리(p)까지만 본다 — 틀림 0 → p, 1 → ceil(p/2), 2 이상 → 0.
 * 그 뒤 줄은 시도하지 않은 것이라 0.
 */
export function binaryRowScore(expected: string, answered: string, rowLen = BINARY_ROW): {
  score: number; max: number; rows: RowScore[];
} {
  const rows: RowScore[] = [];
  const count = Math.ceil(expected.length / rowLen);
  const exps = Array.from({ length: count }, (_, r) => expected.slice(r * rowLen, (r + 1) * rowLen));
  const anss = exps.map((exp, r) => answered.slice(r * rowLen, r * rowLen + exp.length));
  const last = anss.findLastIndex((a) => a.trim() !== '');

  for (let r = 0; r < count; r++) {
    const exp = exps[r];
    const ans = anss[r];
    if (r > last) {
      rows.push({ score: 0, max: exp.length, errors: 0, attempted: false });
      continue;
    }
    /* 마지막 줄은 적은 데까지만, 앞줄은 줄 전체를 본다 */
    const seen = r === last ? ans.trimEnd().length : exp.length;
    let errors = 0;
    for (let i = 0; i < seen; i++) if (ans[i] !== exp[i]) errors++;
    const score = errors === 0 ? seen : errors === 1 ? Math.ceil(seen / 2) : 0;
    rows.push({ score, max: exp.length, errors, attempted: true });
  }
  return { score: rows.reduce((a, x) => a + x.score, 0), max: expected.length, rows };
}
