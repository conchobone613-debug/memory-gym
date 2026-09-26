import { makeAddition, makeMultiply } from './arith';
import type { Problem } from './problem';
import { randInt, type Rng } from './rng';
import { ROUNDING_NAME, type Rounding } from './sqrt';

/*
 * 서프라이즈 — 유형 등록부. 유형 하나 = 문제 만들기(정답·풀이는 코드가 BigInt 로 낸다).
 * 새 유형은 SURPRISE_TYPES 에 한 줄을 더한다 — 유형 고르기·섞기·모의 대회 순서·기록(calcItems.kind = id)이 이 배열만 본다.
 */

export interface SurpriseCtx {
  /** 규정의 끝자리(나눗셈) */
  rounding: Rounding;
}

export interface SurpriseType {
  /** calcItems.kind 에 그대로 들어간다 — 서프라이즈 종목 안에서 유형을 가른다 */
  id: string;
  /** 평문 — 유형 고르기·기록 줄 */
  name: string;
  /** kind 는 makeSurprise 가 id 로 덮는다 */
  make(rng: Rng, ctx: SurpriseCtx): Problem;
  /** 답을 어떻게 적나(평문) — 정수가 아닌 답만. 안내 줄에 붙는다 */
  answer?(ctx: SurpriseCtx): string;
}

/** 섞기 — 유형을 고르지 않은 판(사다리·모의 대회) */
export const MIX = 'mix';

const MINUS = '−';
const STEP = ['①', '②', '③'];

/** [lo, hi] 정수 */
const between = (rng: Rng, lo: number, hi: number) => lo + randInt(rng, hi - lo + 1);
/** d 자리 수(첫 자리는 0 이 아니다) */
const num = (rng: Rng, d: number) => BigInt(between(rng, 10 ** (d - 1), 10 ** d - 1));

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 제곱 — n(2~4자리) = h×10 + u 로 쪼개 h²×100 + 2hu×10 + u² */
function makeSquare(rng: Rng): Problem {
  const n = num(rng, between(rng, 2, 4));
  const h = n / 10n;
  const u = n % 10n;
  return {
    kind: 'sq', prompt: `${n}²`, expected: String(n * n),
    explain: [
      `${n} = ${h}×10 + ${u}`,
      `${n}² = ${h}²×100 + 2×${h}×${u}×10 + ${u}²`,
      `= ${h * h * 100n} + ${2n * h * u * 10n} + ${u * u}`,
      `${n}² = ${n * n}`,
    ],
  };
}

/** 식 문항 — 풀이는 단계마다 '① 47 + 38 = 85', 정답은 마지막 단계 값 */
const exprOf = (prompt: string, steps: [string, bigint][]): Problem => ({
  kind: 'expr', prompt, expected: String(steps.at(-1)![1]), explain: steps.map(([s, v], i) => `${STEP[i]} ${s} = ${v}`),
});

/** 괄호 있는 다단계 계산 — 세 꼴 중 하나, 모두 정수·결과 양수 */
function makeExpr(rng: Rng): Problem {
  const form = randInt(rng, 3);
  for (;;) {
    if (form === 0) {
      const a = num(rng, 2), b = num(rng, 2), c = BigInt(between(rng, 3, 9)), d = num(rng, 2);
      const s = a + b, m = s * c;
      if (m - d <= 0n) continue;
      return exprOf(`(${a} + ${b}) × ${c} ${MINUS} ${d}`, [[`${a} + ${b}`, s], [`${s} × ${c}`, m], [`${m} ${MINUS} ${d}`, m - d]]);
    }
    if (form === 1) {
      const a = num(rng, between(rng, 2, 3)), b = num(rng, between(rng, 2, 3));
      if (a <= b) continue;
      const c = num(rng, 2), d = num(rng, 2);
      const x = a - b, y = c + d;
      return exprOf(`(${a} ${MINUS} ${b}) × (${c} + ${d})`, [[`${a} ${MINUS} ${b}`, x], [`${c} + ${d}`, y], [`${x} × ${y}`, x * y]]);
    }
    /* 나머지 없이 떨어지게 몫 q 부터 정하고 c 를 맞춘다 */
    const d = BigInt(between(rng, 3, 9)), q = BigInt(between(rng, 12, 99)), a = num(rng, 2), b = BigInt(between(rng, 1, 9));
    const c = q * d - a * b;
    if (c < 0n) continue;
    const p = a * b;
    return exprOf(`(${a} × ${b} + ${c}) ÷ ${d}`, [[`${a} × ${b}`, p], [`${p} + ${c}`, p + c], [`${p + c} ÷ ${d}`, q]]);
  }
}

/** a ÷ b 를 소수 둘째 자리까지(늘 두 자리) — 버림 floor(100a / b), 반올림(셋째 자리 half-up) floor((200a + b) / 2b) */
export function divAnswer(a: bigint, b: bigint, r: Rounding): string {
  const v = r === 'round' ? (200n * a + b) / (2n * b) : (100n * a) / b;
  return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
}

/** 나눗셈 풀이 — 몫·나머지, 나머지 × 10 으로 소수 자리를 하나씩(반올림이면 셋째까지), 끝에 '버림 → 1582.76' */
export function divExplain(a: bigint, b: bigint, r: Rounding): string[] {
  const out = [`${a} ÷ ${b} = ${a / b} 나머지 ${a % b}`];
  let rem = a % b;
  for (const place of r === 'round' ? ['첫째', '둘째', '셋째'] : ['첫째', '둘째']) {
    const n = rem * 10n;
    out.push(`${n} ÷ ${b} = ${n / b} 나머지 ${n % b} → 소수 ${place} ${n / b}`);
    rem = n % b;
  }
  out.push(`${ROUNDING_NAME[r]} → ${divAnswer(a, b, r)}`);
  return out;
}

/** 나눗셈 — a 4~6자리 ÷ b 2~3자리(10 의 배수 아님) */
function makeDivision(rng: Rng, ctx: SurpriseCtx): Problem {
  const a = num(rng, between(rng, 4, 6));
  let b = 0n;
  while (b % 10n === 0n) b = num(rng, between(rng, 2, 3));
  return { kind: 'div', prompt: `${a} ÷ ${b}`, expected: divAnswer(a, b, ctx.rounding), explain: divExplain(a, b, ctx.rounding) };
}

export const SURPRISE_TYPES: SurpriseType[] = [
  { id: 'sq', name: '제곱', make: makeSquare },
  { id: 'mul3', name: '3×3 곱셈', make: (rng) => makeMultiply(rng, { a: 3, b: 3 }) },
  { id: 'expr', name: '괄호 계산', make: makeExpr },
  { id: 'div', name: '나눗셈', make: makeDivision, answer: (c) => `소수 둘째 자리 · ${ROUNDING_NAME[c.rounding]}` },
  { id: 'add10', name: '2자리 10개 덧셈', make: (rng) => makeAddition(rng, { digits: 2, terms: 10 }) },
];

/** 문항 하나 — type 이 등록부에 있으면 그 유형, 없거나 섞기면 등록부에서 무작위(시드). kind = 유형 id */
export function makeSurprise(rng: Rng, ctx: SurpriseCtx, opts: { type?: string; types?: SurpriseType[] } = {}): Problem {
  const types = opts.types ?? SURPRISE_TYPES;
  const t = types.find((x) => x.id === opts.type) ?? types[randInt(rng, types.length)];
  return { ...t.make(rng, ctx), kind: t.id };
}

/** 모의 대회 유형 순서 — 유형 목록을 (돌 때마다 섞어) 되풀이해 items 개를 채우고 다시 섞는다. items ≥ 유형 수면 모든 유형이 한 번 이상 */
export function contestTypes(rng: Rng, items: number, types = SURPRISE_TYPES): string[] {
  const out: string[] = [];
  while (types.length && out.length < items) out.push(...shuffle(rng, types.map((t) => t.id)));
  return shuffle(rng, out.slice(0, items));
}

/** 한 판 문항 — 유형 하나면 그 유형만, 섞기면 contestTypes 순서(모든 유형이 고르게) */
export function makeSurpriseRun(rng: Rng, ctx: SurpriseCtx, count: number, opts: { type?: string; types?: SurpriseType[] } = {}): Problem[] {
  const types = opts.types ?? SURPRISE_TYPES;
  const one = types.find((t) => t.id === opts.type);
  const order = one ? Array<string>(count).fill(one.id) : contestTypes(rng, count, types);
  return order.map((type) => makeSurprise(rng, ctx, { type, types }));
}

/** 유형 고르기 선택지 — 섞기가 먼저(기본) */
export const surpriseTypeOptions = (types = SURPRISE_TYPES): { value: string; label: string }[] =>
  [{ value: MIX, label: '섞기' }, ...types.map((t) => ({ value: t.id, label: t.name }))];

/** 이름 뒤 은/는 — 끝 글자 받침으로 */
function topic(w: string): string {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 === 0 ? '는' : '은';
}

/** 안내 줄 — 유형 하나면 그 이름(답 적는 법이 있으면 붙여), 섞기면 '섞어서 · 나눗셈은 소수 둘째 자리 · 버림' */
export function surpriseAsk(ctx: SurpriseCtx, type?: string, types = SURPRISE_TYPES): string {
  const one = types.find((t) => t.id === type);
  if (one) return one.answer ? `${one.name} · ${one.answer(ctx)}` : one.name;
  return ['섞어서', ...types.flatMap((t) => (t.answer ? [`${t.name}${topic(t.name)} ${t.answer(ctx)}`] : []))].join(' · ');
}
