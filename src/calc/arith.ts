import type { Problem } from './problem';
import { randInt, type Rng } from './rng';

/*
 * 덧셈·곱셈 문제 — 정답은 BigInt, 풀이는 자리 계산(addColumns·mulColumns)으로 코드가 만든다.
 * 곱셈 풀이는 대회에서 쓰는 교차곱셈: 결과 k 자리 = Σ a_i·b_j (i+j=k, 일의 자리부터) + 올림.
 */

export interface AddParams {
  digits: number;
  terms: number;
}

export interface MulParams {
  a: number;
  b: number;
}

/** 자리 하나의 셈. total = sum + carryIn, digit = total % 10, carryOut = total ÷ 10 */
interface ColumnBase {
  /** 0 = 일의 자리 */
  col: number;
  sum: number;
  carryIn: number;
  total: number;
  digit: number;
  carryOut: number;
}

export interface AddColumn extends ColumnBase {
  /** 이 자리의 숫자들(그 자리까지 닿는 수만, 적힌 순서) */
  digits: number[];
}

export interface MulColumn extends ColumnBase {
  /** [A 의 숫자, B 의 숫자] — A 의 높은 자리부터(바깥 → 안쪽 교차) */
  pairs: [number, number][];
}

/** digits 자리 수 글자 — 첫 자리는 0 이 아니다(1자리면 1–9) */
function randNumber(rng: Rng, digits: number): string {
  let s = String(1 + randInt(rng, 9));
  for (let i = 1; i < digits; i++) s += String(randInt(rng, 10));
  return s;
}

/** 오른쪽(일의 자리)부터 k 번째 숫자. 없으면 null */
const digitAt = (s: string, k: number): number | null => (k < s.length ? Number(s[s.length - 1 - k]) : null);

function settle<T extends object>(col: number, sum: number, carryIn: number, extra: T): T & ColumnBase {
  const total = sum + carryIn;
  return { col, ...extra, sum, carryIn, total, digit: total % 10, carryOut: Math.floor(total / 10) };
}

/** 덧셈 자리 계산 — 일의 자리부터. 마지막 carryOut 이 합의 맨 앞에 붙는다 */
export function addColumns(terms: string[]): AddColumn[] {
  const width = Math.max(0, ...terms.map((t) => t.length));
  const out: AddColumn[] = [];
  let carry = 0;
  for (let col = 0; col < width; col++) {
    const digits = terms.map((t) => digitAt(t, col)).filter((d) => d !== null);
    const c = settle(col, digits.reduce((a, d) => a + d, 0), carry, { digits });
    out.push(c);
    carry = c.carryOut;
  }
  return out;
}

/** 교차곱셈 자리 계산 — 일의 자리부터. 마지막 carryOut 이 곱의 맨 앞에 붙는다 */
export function mulColumns(A: string, B: string): MulColumn[] {
  const out: MulColumn[] = [];
  let carry = 0;
  for (let col = 0; col < A.length + B.length - 1; col++) {
    const pairs: [number, number][] = [];
    for (let i = Math.min(col, A.length - 1); i >= 0 && col - i < B.length; i--) pairs.push([digitAt(A, i)!, digitAt(B, col - i)!]);
    const c = settle(col, pairs.reduce((a, [x, y]) => a + x * y, 0), carry, { pairs });
    out.push(c);
    carry = c.carryOut;
  }
  return out;
}

/** 자리 셈을 이어 붙인 결과 — 마지막 올림(있으면) + 높은 자리부터 digit */
export const joinColumns = (cols: ColumnBase[]): string =>
  `${cols.at(-1)?.carryOut || ''}${cols.map((c) => c.digit).reverse().join('')}` || '0';

const PLACE = ['일', '십', '백', '천', '만', '십만', '백만', '천만', '억', '십억', '백억', '천억', '조', '십조', '백조', '천조'];

/** '일의 자리' · '천만의 자리' — 천조를 넘으면 '17째 자리' */
export const placeName = (col: number) => (col < PLACE.length ? `${PLACE[col]}의 자리` : `${col + 1}째 자리`);

/** 수 뒤의 을/를 — 읽는 소리의 끝 글자(이·사·오·구 는 받침 없음, 0 은 십·백… 으로 끝나 받침 있음) */
const eulReul = (n: number) => ([2, 4, 5, 9].includes(n % 10) ? '를' : '을');

/** 자리 줄 뒷부분 — ' = 22, 올림 1 더해 23 → 3, 올림 2' */
const tail = (c: ColumnBase) =>
  ` = ${c.sum}${c.carryIn ? `, 올림 ${c.carryIn} 더해 ${c.total}` : ''} → ${c.digit}${c.carryOut ? `, 올림 ${c.carryOut}` : ''}`;

function finalCarry(cols: ColumnBase[]): string[] {
  const c = cols.at(-1)?.carryOut ?? 0;
  return c ? [`마지막 올림 ${c}${eulReul(c)} 앞에 붙입니다`] : [];
}

/** 덧셈 풀이 — 자리마다 한 줄, 끝에 '합 = …' */
export function addExplain(terms: string[]): string[] {
  const cols = addColumns(terms);
  return [
    ...cols.map((c) => `${placeName(c.col)}: ${c.digits.join('+')}${tail(c)}`),
    ...finalCarry(cols),
    `합 = ${joinColumns(cols)}`,
  ];
}

/** 곱셈 풀이 — '교차곱셈 — 일의 자리부터', 자리마다 한 줄, 끝에 '곱 = …' */
export function mulExplain(A: string, B: string): string[] {
  const cols = mulColumns(A, B);
  return [
    '교차곱셈 — 일의 자리부터',
    ...cols.map((c) => `${placeName(c.col)}: ${c.pairs.map(([x, y]) => `${x}×${y}`).join(' + ')}${tail(c)}`),
    ...finalCarry(cols),
    `곱 = ${joinColumns(cols)}`,
  ];
}

/** 덧셈 문항 — 수 terms 개, 각각 digits 자리. 이웃한 두 수는 같지 않다(플래시에서 같은 수가 이어지면 바뀐 줄 모른다) */
export function makeAddition(rng: Rng, p: AddParams): Problem {
  const nums: string[] = [];
  while (nums.length < p.terms) {
    const s = randNumber(rng, p.digits);
    if (s !== nums.at(-1)) nums.push(s);
  }
  return {
    kind: 'add', prompt: nums.join(' + '), lines: nums,
    expected: nums.reduce((a, s) => a + BigInt(s), 0n).toString(), explain: addExplain(nums),
  };
}

/** 곱셈 문항 — a 자리 × b 자리. 세로셈 두 줄(한 줄이면 8×8 이 19자라 휴대폰 폭을 넘는다) */
export function makeMultiply(rng: Rng, p: MulParams): Problem {
  const A = randNumber(rng, p.a);
  const B = randNumber(rng, p.b);
  return {
    kind: 'mul', prompt: `${A} × ${B}`, lines: [A, `× ${B}`],
    expected: (BigInt(A) * BigInt(B)).toString(), explain: mulExplain(A, B),
  };
}
