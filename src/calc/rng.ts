/*
 * 시드 난수 — 같은 시드면 같은 문제가 나온다(기획서 §5.7).
 * 복기·재도전에 쓰고, 2단계에서 서버가 같은 문제를 다시 만들어 검증하는 토대가 된다.
 * 시드 자체는 crypto 로 뽑는다(예측 불가). 문제를 만드는 쪽은 이 결정적 난수만 쓴다.
 */

export type Rng = () => number;

/** 문자열 시드 → 32비트 네 개 (cyrb128) */
function hash128(s: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32 — 짧고 품질이 충분한 결정적 난수. [0, 1) */
export function seeded(seed: string): Rng {
  let [a, b, c, d] = hash128(seed);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** [0, n) 정수 */
export const randInt = (rng: Rng, n: number) => Math.floor(rng() * n);

/** 새 시드(16진 16자리). 세션마다 하나. */
export function newSeed(): string {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(8, '0')).join('');
}
