import { describe, expect, it } from 'vitest';
import { fixed, isqrt, sqrtSig } from './bigmath';
import { randInt, seeded } from './rng';

/** 소수 글자 → (소수점 뺀 정수, 소수 자리 수) */
const parse = (s: string) => {
  const [ip, fp = ''] = s.split('.');
  return { V: BigInt(ip + fp), d: fp.length };
};

/** 반올림을 다른 길로 — 버림 sig+1 자리 글자의 마지막 자리로 글자 올림(9 이어짐·자리 넘침 포함) */
function roundRef(N: bigint, sig: number): string {
  const D = isqrt(N).toString().length;
  const S = Math.max(sig, D);
  const [ip, fp] = sqrtSig(N, S + 1, 'trunc').split('.');
  const digits = (ip + fp).split('').map(Number);
  let places = fp.length - 1;
  if (digits.pop()! >= 5) {
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 9) digits[i--] = 0;
    if (i < 0) digits.unshift(1);
    else digits[i] += 1;
  }
  if (digits.length > S && places > 0) {
    digits.pop();
    places -= 1;
  }
  const s = digits.join('');
  return places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
}

/** digits 자리 무작위 수(첫 자리 0 아님) */
const randN = (r: () => number, digits: number) => {
  let s = String(1 + randInt(r, 9));
  for (let i = 1; i < digits; i++) s += String(randInt(r, 10));
  return BigInt(s);
};

describe('isqrt', () => {
  it('0 · 1 · 작은 수', () => {
    expect([0n, 1n, 2n, 3n, 4n, 8n, 9n, 10n].map(isqrt)).toEqual([0n, 1n, 1n, 1n, 2n, 2n, 3n, 3n]);
  });

  it('완전제곱 경계: k²−1 · k² · k²+1', () => {
    const ks = [2n, 3n, 10n, 99n, 1000n, 65535n, 65536n, 4294967295n, 10n ** 15n + 7n];
    for (const k of ks) {
      expect(isqrt(k * k - 1n), `${k}`).toBe(k - 1n);
      expect(isqrt(k * k), `${k}`).toBe(k);
      expect(isqrt(k * k + 1n), `${k}`).toBe(k);
    }
  });

  it('아주 큰 수(10^40 근처)', () => {
    const t = 10n ** 20n;
    expect(isqrt(10n ** 40n)).toBe(t);
    expect(isqrt(10n ** 40n - 1n)).toBe(t - 1n);
    expect(isqrt(10n ** 40n + 1n)).toBe(t);
    const n = 10n ** 41n + 12345n;
    const r = isqrt(n);
    expect(r * r <= n && n < (r + 1n) * (r + 1n)).toBe(true);
  });

  it('음수는 받지 않는다', () => {
    expect(() => isqrt(-1n)).toThrow();
  });
});

describe('sqrtSig — 유효숫자', () => {
  it('버림 성질: 적은 값 V(소수 d 자리)가 V² ≤ N·10^2d < (V+1)² — 무작위 수천 개', () => {
    const r = seeded('sqrt-sig');
    for (let i = 0; i < 4000; i++) {
      const digits = 2 + randInt(r, 11);
      const sig = 2 + randInt(r, 11);
      const N = randN(r, digits);
      const out = sqrtSig(N, sig, 'trunc');
      const { V, d } = parse(out);
      const scaled = N * 10n ** BigInt(2 * d);
      expect(V * V <= scaled && scaled < (V + 1n) * (V + 1n), `√${N} sig ${sig} → ${out}`).toBe(true);
      /* 유효숫자 = sig, 단 정수부가 더 길면 정수부 전체 */
      expect(V.toString().length, `√${N} sig ${sig}`).toBe(Math.max(sig, isqrt(N).toString().length));
    }
  });

  it('반올림 = 버림 sig+1 자리의 마지막 자리로 올린 값(따로 만든 계산과 대조)', () => {
    const r = seeded('sqrt-round');
    for (let i = 0; i < 4000; i++) {
      const sig = 2 + randInt(r, 11);
      const N = randN(r, 2 + randInt(r, 11));
      expect(sqrtSig(N, sig, 'round'), `√${N} sig ${sig}`).toBe(roundRef(N, sig));
    }
    /* 자리 넘침이 나는 수(9 가 길게 이어지는 √)도 따로 대조한다 */
    for (const N of [99n, 9999n, 999999n, 99999999n, 9999999999n, 999999999999n]) {
      for (let sig = 2; sig <= 12; sig++) expect(sqrtSig(N, sig, 'round'), `√${N} sig ${sig}`).toBe(roundRef(N, sig));
    }
  });

  it('√1000 유효 4 → 31.62 · √123456 유효 8 버림 → 351.36306', () => {
    expect(sqrtSig(1000n, 4, 'trunc')).toBe('31.62');
    expect(sqrtSig(1000n, 4, 'round')).toBe('31.62');
    expect(sqrtSig(123456n, 8, 'trunc')).toBe('351.36306');
  });

  it('완전제곱수도 유효숫자까지 0 을 채운다', () => {
    expect(sqrtSig(250000n, 8, 'trunc')).toBe('500.00000');
    expect(sqrtSig(250000n, 8, 'round')).toBe('500.00000');
    expect(sqrtSig(144n, 4, 'trunc')).toBe('12.00');
    expect(sqrtSig(100n, 2, 'trunc')).toBe('10');
  });

  it('올림 자리 넘침: 정수부가 한 자리 늘고 소수 자리가 준다(소수가 없으면 소수점도 없다)', () => {
    expect(sqrtSig(9999n, 3, 'round')).toBe('100');
    expect(sqrtSig(9999n, 3, 'trunc')).toBe('99.9');
    expect(sqrtSig(999999n, 4, 'round')).toBe('1000');
    expect(sqrtSig(99999999n, 6, 'round')).toBe('10000.0');
    expect(sqrtSig(99999999n, 6, 'trunc')).toBe('9999.99');
  });

  it('유효숫자가 정수부보다 짧으면 정수 전체를 적는다', () => {
    expect(sqrtSig(99999999999n, 2, 'trunc')).toBe('316227');
    expect(sqrtSig(99999999999n, 2, 'round')).toBe('316228');
    expect(sqrtSig(123456n, 2, 'trunc')).toBe('351');
  });

  it('끝이 9 로 이어지면 반올림이 여러 자리를 올린다', () => {
    /* √100838 = 317.549996… */
    expect(sqrtSig(100838n, 8, 'trunc')).toBe('317.54999');
    expect(sqrtSig(100838n, 8, 'round')).toBe('317.55000');
    /* √105599 = 324.959997… */
    expect(sqrtSig(105599n, 8, 'round')).toBe('324.96000');
  });
});

describe('fixed', () => {
  it('나눗셈을 소수 places 자리까지 버림', () => {
    expect(fixed(1n, 3n, 4)).toBe('0.3333');
    expect(fixed(2n, 3n, 4)).toBe('0.6666');
    expect(fixed(255n, 702n, 5)).toBe('0.36324');
    expect(fixed(7n, 2n, 0)).toBe('3');
    expect(fixed(-1n, 8n, 3)).toBe('-0.125');
  });
});
