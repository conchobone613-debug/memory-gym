/*
 * 큰 정수 셈 — 정답·풀이는 BigInt 로만 낸다. 부동소수점은 유효숫자 끝자리에서 틀릴 수 있다.
 */

/** floor(√n). 뉴턴법 — 위에서 내려오며 멈춘 곳이 답이다 */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('음수의 제곱근은 구할 수 없습니다');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

const pow10 = (k: number) => 10n ** BigInt(k);

/** 정수 v 를 소수 places 자리 글자로(v = 값 × 10^places) */
function withPoint(v: bigint, places: number): string {
  if (places <= 0) return v.toString();
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(places + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -places)}.${s.slice(-places)}`;
}

/**
 * √N 을 유효숫자 sig 자리로. 정수부는 언제나 다 적는다(sig 가 정수부 자릿수보다 작으면 그 자릿수로 올린다).
 * floor(√(N·10^2k)) 로 sig+1 자리를 정확히 얻어, trunc 는 버리고 round 는 다음 자리가 5 이상이면 올린다.
 * 올림으로 자리가 넘치면(99.99|6 → 100.0) 정수부가 한 자리 늘고 소수 자리가 하나 준다.
 */
export function sqrtSig(N: bigint, sig: number, rounding: 'trunc' | 'round'): string {
  if (N < 1n) throw new RangeError('1 이상의 수만 받습니다');
  const intDigits = isqrt(N).toString().length;
  const total = Math.max(sig, intDigits);
  let places = total - intDigits;
  const next = isqrt(N * pow10(2 * (places + 1)));
  let v = rounding === 'round' ? (next + 5n) / 10n : next / 10n;
  if (v.toString().length > total && places > 0) {
    v /= 10n;
    places -= 1;
  }
  return withPoint(v, places);
}

/** numer ÷ denom 을 소수 places 자리까지 버림(0 쪽으로)한 글자 — 풀이 줄에 쓴다 */
export function fixed(numer: bigint, denom: bigint, places: number): string {
  if (denom === 0n) throw new RangeError('0 으로 나눌 수 없습니다');
  return withPoint((numer * pow10(Math.max(0, places))) / denom, places);
}
