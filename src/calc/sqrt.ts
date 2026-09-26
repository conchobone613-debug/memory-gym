import { fixed, isqrt, sqrtSig } from './bigmath';
import type { Problem } from './problem';
import { randInt, type Rng } from './rng';

/*
 * 제곱근 문제 — N(digits 자리)의 √ 를 유효숫자 sig 자리로. 정답·풀이는 모두 BigInt 로 계산한다.
 * 풀이는 대회에서 쓰는 '추정 → 정밀화': 가까운 제곱수 a² 에서 x₀ = a + r ÷ 2a, 뉴턴 한 번으로 x₁.
 */

export type Rounding = 'trunc' | 'round';

export interface SqrtParams {
  digits: number;
  sig: number;
  rounding: Rounding;
}

export const ROUNDING_NAME: Record<Rounding, string> = { trunc: '버림', round: '반올림' };

/** 분수 n / d */
export interface Frac { n: bigint; d: bigint }

/** 추정·정밀화 값(정확한 분수). x₀ = a + r ÷ 2a, x₁ = (x₀² + N) ÷ 2x₀ = x₀ − (r ÷ 2a)² ÷ 2x₀ */
export function sqrtSteps(N: bigint): { a: bigint; r: bigint; x0: Frac; x1: Frac } {
  const a = isqrt(N);
  const x0 = { n: a * a + N, d: 2n * a };
  return { a, r: N - a * a, x0, x1: { n: x0.n * x0.n + N * x0.d * x0.d, d: 2n * x0.n * x0.d } };
}

/** 풀이 줄들 — 마지막 줄은 '… → 정답' */
export function sqrtExplain(N: bigint, sig: number, rounding: Rounding): string[] {
  const { a, r, x0, x1 } = sqrtSteps(N);
  const intDigits = a.toString().length;
  const lines = [`가까운 제곱수: ${a}² = ${a * a} ≤ ${N} < ${a + 1n}² = ${(a + 1n) ** 2n}`];
  if (r === 0n) {
    lines.push(`나머지가 없어 정확히 ${a}입니다.`);
  } else {
    /* 추정 값은 정답보다 두 자리 더 적어 정밀화가 어디서 맞아 드는지 보이게 */
    const places = Math.max(0, sig - intDigits) + 2;
    lines.push(
      `나머지 r = ${N} − ${a * a} = ${r}`,
      `첫 추정 x₀ = ${a} + ${r} ÷ ${2n * a} = ${fixed(x0.n, x0.d, places)}`,
      `정밀화 x₁ = x₀ − (${r} ÷ ${2n * a})² ÷ (2·x₀) = ${fixed(x1.n, x1.d, places)}`,
      `정확한 값 √${N} = ${sqrtSig(N, Math.max(sig, intDigits) + 2, 'trunc')}…`,
    );
  }
  const whole = sig < intDigits ? '(정수부는 모두)' : '';
  lines.push(`유효숫자 ${sig}자리${whole} ${ROUNDING_NAME[rounding]} → ${sqrtSig(N, sig, rounding)}`);
  return lines;
}

/** 제곱근 문항 하나. N 의 첫 자리는 0 이 아니다. 난수는 세션 시드(rng)만 쓴다 */
export function makeSqrt(rng: Rng, p: SqrtParams): Problem {
  let s = String(1 + randInt(rng, 9));
  for (let i = 1; i < p.digits; i++) s += String(randInt(rng, 10));
  const N = BigInt(s);
  return { kind: 'sqrt', prompt: `√${N}`, expected: sqrtSig(N, p.sig, p.rounding), explain: sqrtExplain(N, p.sig, p.rounding) };
}
