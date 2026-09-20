import type { ImageStat, MemoImage, PickMode } from '../db/db';
import { sample, shuffle } from './random';

const DAY = 86_400_000;

export interface Ranked {
  image: MemoImage;
  stat?: ImageStat;
  priority: number;
  /** 반응시간 백분위(0=가장 빠름, 1=가장 느림). 표본이 없으면 undefined */
  rtRank?: number;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/**
 * 우선순위 = 느림 + 오답 + 오래됨.
 * 한 번도 안 본 이미지는 최상위로 올려 먼저 익히게 한다.
 */
export function rank(images: MemoImage[], stats: Map<string, ImageStat>, now = Date.now()): Ranked[] {
  const withRt = images
    .map((i) => stats.get(i.id))
    .filter((s): s is ImageStat => !!s && s.rtSamples.length > 0)
    .map((s) => s.medianRt)
    .sort((a, b) => a - b);

  const rtRankOf = (rt: number) => {
    if (withRt.length < 2) return 0.5;
    const below = withRt.filter((x) => x < rt).length;
    return below / (withRt.length - 1);
  };

  return images.map((image) => {
    const stat = stats.get(image.id);
    if (!stat || stat.attempts === 0) {
      return { image, stat, priority: 1.5 }; // 미학습 최우선
    }
    const rtRank = stat.rtSamples.length ? rtRankOf(stat.medianRt) : 0.5;
    const errRate = stat.attempts ? stat.wrong / stat.attempts : 0;
    const recency = 1 - Math.exp(-(now - stat.lastSeenAt) / (3 * DAY));
    let p = 0.45 * rtRank + 0.4 * errRate + 0.15 * recency;
    if (rtRank >= 0.8) p += 0.5; // 반응시간 상위 20% (가장 느린 쪽)
    if (stat.wrongStreak > 0) p += 0.8;
    return { image, stat, priority: p, rtRank };
  });
}

/** 출제 목록 생성. srs 는 우선순위 70% + 무작위 30% 로 섞어 잘 되는 이미지도 녹슬지 않게 한다. */
export function buildQueue(ranked: Ranked[], count: number, mode: PickMode): MemoImage[] {
  if (ranked.length === 0) return [];
  const sorted = [...ranked].sort((a, b) => b.priority - a.priority);

  const pickFrom = (list: Ranked[], n: number): MemoImage[] => {
    const out: MemoImage[] = [];
    while (out.length < n && list.length > 0) {
      out.push(...sample(list, Math.min(n - out.length, list.length)).map((r) => r.image));
    }
    return out;
  };

  switch (mode) {
    case 'all':
      return shuffle(pickFrom(sorted, count));
    case 'weak':
      return shuffle(pickFrom(sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25))), count));
    case 'unseen': {
      const unseen = sorted.filter((r) => !r.stat || r.stat.attempts === 0);
      return shuffle(pickFrom(unseen.length ? unseen : sorted, count));
    }
    case 'srs':
    default: {
      const nTop = Math.round(count * 0.7);
      const bandSize = Math.max(nTop, Math.ceil(sorted.length * 0.4));
      const band = sorted.slice(0, bandSize);
      const rest = sorted.slice(bandSize);
      const picked = [
        ...pickFrom(band, nTop),
        ...pickFrom(rest.length ? rest : sorted, count - nTop),
      ];
      return shuffle(picked);
    }
  }
}
