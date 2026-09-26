import { describe, expect, it } from 'vitest';
import { fixed, isqrt, sqrtSig } from './bigmath';
import { normalizeAnswer } from './problem';
import { randInt, seeded } from './rng';
import { makeSqrt, sqrtExplain, sqrtSteps } from './sqrt';

describe('normalizeAnswer', () => {
  it('공백·쉼표를 지우고 앞의 0 을 뗀다', () => {
    expect(normalizeAnswer(' 351.36306 ')).toBe('351.36306');
    expect(normalizeAnswer('0351.36306')).toBe('351.36306');
    expect(normalizeAnswer('1,234,567')).toBe('1234567');
    expect(normalizeAnswer('100.')).toBe('100');
  });

  it("'0.xx' 의 0 은 두고, 끝의 0 은 유효숫자라 지우지 않는다", () => {
    expect(normalizeAnswer('0.5')).toBe('0.5');
    expect(normalizeAnswer('00.5')).toBe('0.5');
    expect(normalizeAnswer('0')).toBe('0');
    expect(normalizeAnswer('351.363060')).toBe('351.363060');
    expect(normalizeAnswer('351.363060') === sqrtSig(123456n, 8, 'trunc')).toBe(false);
  });
});

describe('제곱근 문제', () => {
  it('같은 시드면 같은 문제 · N 은 digits 자리(첫 자리 0 아님) · 정답은 sqrtSig', () => {
    const p = { digits: 6, sig: 8, rounding: 'trunc' as const };
    const a = Array.from({ length: 50 }, ((r) => () => makeSqrt(r, p))(seeded('s1')));
    const b = Array.from({ length: 50 }, ((r) => () => makeSqrt(r, p))(seeded('s1')));
    expect(a).toEqual(b);
    for (const q of a) {
      expect(q.kind).toBe('sqrt');
      expect(q.prompt).toMatch(/^√[1-9]\d{5}$/);
      expect(q.expected).toBe(sqrtSig(BigInt(q.prompt.slice(1)), 8, 'trunc'));
      expect(normalizeAnswer(q.expected)).toBe(q.expected);
    }
  });

  it('풀이 마지막 줄이 정답이다', () => {
    const r = seeded('explain');
    for (let i = 0; i < 500; i++) {
      const p = { digits: 2 + randInt(r, 11), sig: 2 + randInt(r, 11), rounding: randInt(r, 2) ? 'round' as const : 'trunc' as const };
      const q = makeSqrt(r, p);
      expect(q.explain.at(-1), q.prompt).toMatch(new RegExp(`→ ${q.expected.replace('.', '\\.')}$`));
    }
  });

  it('√123456 유효 8 버림 — 추정 → 정밀화 줄', () => {
    expect(sqrtExplain(123456n, 8, 'trunc')).toEqual([
      '가까운 제곱수: 351² = 123201 ≤ 123456 < 352² = 123904',
      '나머지 r = 123456 − 123201 = 255',
      '첫 추정 x₀ = 351 + 255 ÷ 702 = 351.3632478',
      '정밀화 x₁ = x₀ − (255 ÷ 702)² ÷ (2·x₀) = 351.3630600',
      '정확한 값 √123456 = 351.3630600…',
      '유효숫자 8자리 버림 → 351.36306',
    ]);
  });

  it('완전제곱수는 나머지가 없다고 짧게', () => {
    expect(sqrtExplain(250000n, 8, 'round')).toEqual([
      '가까운 제곱수: 500² = 250000 ≤ 250000 < 501² = 251001',
      '나머지가 없어 정확히 500입니다.',
      '유효숫자 8자리 반올림 → 500.00000',
    ]);
  });

  it('추정·정밀화가 실제 √N 에 다가간다: |x₁−√N| < |x₀−√N|', () => {
    const r = seeded('newton');
    for (let i = 0; i < 2000; i++) {
      let s = String(1 + randInt(r, 9));
      for (let k = 1, n = 2 + randInt(r, 11); k < n; k++) s += String(randInt(r, 10));
      const N = BigInt(s);
      const { a, r: rest, x0, x1 } = sqrtSteps(N);
      expect(a).toBe(isqrt(N));
      if (rest === 0n) continue;
      /* 둘 다 위에서 다가온다(x ≥ √N ⟺ x² ≥ N) — 그러면 x₁ < x₀ 이 곧 x₁ 이 더 가깝다는 뜻 */
      expect(x0.n * x0.n >= N * x0.d * x0.d, s).toBe(true);
      expect(x1.n * x1.n >= N * x1.d * x1.d, s).toBe(true);
      expect(x1.n * x0.d < x0.n * x1.d, s).toBe(true);
      /* 풀이 줄에 적은 값이 이 분수를 버림한 값이다 */
      const places = Math.max(0, 8 - a.toString().length) + 2;
      const lines = sqrtExplain(N, 8, 'trunc');
      expect(lines[2].endsWith(`= ${fixed(x0.n, x0.d, places)}`), s).toBe(true);
      expect(lines[3].endsWith(`= ${fixed(x1.n, x1.d, places)}`), s).toBe(true);
    }
  });
});
