/** crypto.getRandomValues 기반 난수. 단순 % 는 모듈로 편향이 생기므로 rejection sampling 을 쓴다. */

export function randBelow(n: number): number {
  if (n <= 0) throw new Error('randBelow: n must be > 0');
  if (n === 1) return 0;
  const limit = Math.floor(0xffffffff / n) * n;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % n;
}

/** Fisher-Yates. 원본을 건드리지 않고 새 배열을 돌려준다. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randBelow(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickOne<T>(items: readonly T[]): T {
  return items[randBelow(items.length)];
}

/** 중복 없이 n개. n이 모집단보다 크면 전체를 섞어서 돌려준다. */
export function sample<T>(items: readonly T[], n: number): T[] {
  return shuffle(items).slice(0, Math.min(n, items.length));
}

/** 가중치 비례 추출(중복 허용). weights 합이 0이면 균등 추출. */
export function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return pickOne(items);
  let r = (randBelow(1_000_000) / 1_000_000) * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function uid(): string {
  return crypto.randomUUID();
}

/**
 * 같은 항목이 연달아 나오지 않게 흩는다.
 *
 * 문항 수가 칸 수보다 많으면 같은 칸이 여러 번 나올 수밖에 없다. 그때 단순히 섞기만 하면
 * 바로 앞 문제와 같은 것이 붙어 나와, 기억을 꺼내는 게 아니라 방금 본 답을 되뇌게 된다.
 *
 * 남은 개수가 가장 많은 것부터 집되 직전 것은 건너뛴다. 이러면 어떤 항목이 전체의 절반을
 * 넘지 않는 한 붙는 일이 없고, 넘을 때도 붙는 횟수가 최소가 된다.
 */
export function spread<T>(items: readonly T[]): T[] {
  const counts = new Map<T, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);

  const out: T[] = [];
  let prev: T | undefined;

  while (out.length < items.length) {
    const left = [...counts.entries()].filter(([, c]) => c > 0);
    if (left.length === 0) break;

    const usable = left.filter(([u]) => u !== prev);
    const from = usable.length > 0 ? usable : left; // 남은 게 직전 것뿐이면 어쩔 수 없다
    const max = Math.max(...from.map(([, c]) => c));
    const top = from.filter(([, c]) => c === max);
    const pick = top[randBelow(top.length)][0];

    out.push(pick);
    counts.set(pick, (counts.get(pick) ?? 1) - 1);
    prev = pick;
  }
  return out;
}
