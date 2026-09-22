import { db, type MappingAttempt, type MappingStat } from './db';
import { allUnits, statKey, type Stage } from '../lib/mapping';
import { median } from '../lib/srs';
import { sample, spread } from '../lib/random';

const MAX_SAMPLES = 20;
const DAY = 86_400_000;

/** 갱신 직전의 통계를 돌려준다 (되돌리기용 — recordAttempt 와 같은 방식). */
export async function recordMapping(a: MappingAttempt): Promise<MappingStat | undefined> {
  return db.transaction('rw', db.mappingAttempts, db.mappingStats, async () => {
    await db.mappingAttempts.add(a);
    const key = statKey(a.stage, a.unit);
    const prev = await db.mappingStats.get(key);
    const base: MappingStat = prev ?? {
      key, stage: a.stage, unit: a.unit,
      attempts: 0, correct: 0, wrong: 0, rtSamples: [], medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    const samples = [...base.rtSamples, a.rtMs].slice(-MAX_SAMPLES);
    await db.mappingStats.put({
      ...base,
      attempts: base.attempts + 1,
      correct: base.correct + (a.isCorrect ? 1 : 0),
      wrong: base.wrong + (a.isCorrect ? 0 : 1),
      rtSamples: samples,
      medianRt: Math.round(median(samples)),
      wrongStreak: a.isCorrect ? 0 : base.wrongStreak + 1,
      lastSeenAt: a.shownAt,
    });
    return prev;
  });
}

/** 바로 앞 답을 없던 일로 한다. */
export async function undoMapping(attemptId: string, key: string, prev?: MappingStat): Promise<void> {
  await db.transaction('rw', db.mappingAttempts, db.mappingStats, async () => {
    await db.mappingAttempts.delete(attemptId);
    if (prev) await db.mappingStats.put(prev);
    else await db.mappingStats.delete(key);
  });
}

export async function mappingStatsFor(stage: Stage): Promise<Map<string, MappingStat>> {
  const rows = await db.mappingStats.where('stage').equals(stage).toArray();
  return new Map(rows.map((r) => [r.unit, r]));
}

/**
 * 출제 순서. 아직 안 본 것 · 틀린 것 · 느린 것을 앞으로 당긴다.
 * 이미지 드릴의 SRS 와 같은 생각이되, 단위가 숫자라 훨씬 단순하다.
 */
export async function buildMappingQueue(stage: Stage, count: number): Promise<string[]> {
  const units = allUnits(stage);
  const stats = await mappingStatsFor(stage);
  const now = Date.now();

  const scored = units.map((unit) => {
    const s = stats.get(unit);
    if (!s || s.attempts === 0) return { unit, p: 2 };
    const errRate = s.wrong / s.attempts;
    const slow = Math.min(1, s.medianRt / 4000);
    const stale = 1 - Math.exp(-(now - s.lastSeenAt) / DAY);
    return { unit, p: 0.45 * errRate + 0.35 * slow + 0.2 * stale + (s.wrongStreak > 0 ? 0.8 : 0) };
  });

  const sorted = [...scored].sort((a, b) => b.p - a.p);
  const nTop = Math.round(count * 0.7);
  const band = sorted.slice(0, Math.max(nTop, Math.ceil(sorted.length * 0.4)));
  const rest = sorted.slice(band.length);

  const take = (list: typeof sorted, n: number): string[] => {
    const out: string[] = [];
    while (out.length < n && list.length) out.push(...sample(list, Math.min(n - out.length, list.length)).map((x) => x.unit));
    return out;
  };

  return spread([...take(band, nTop), ...take(rest.length ? rest : sorted, count - nTop)]);
}
