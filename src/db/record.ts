import { db, type DrillAttempt, type ImageStat } from './db';
import { mean, median } from '../lib/srs';

const MAX_SAMPLES = 30;

/** 시도 1건을 원시 저장하고 파생 통계를 갱신한다. 두 쓰기는 한 트랜잭션으로 묶는다. */
export async function recordAttempt(a: DrillAttempt): Promise<void> {
  await db.transaction('rw', db.drillAttempts, db.imageStats, async () => {
    await db.drillAttempts.add(a);
    const prev = await db.imageStats.get(a.imageId);
    const base: ImageStat = prev ?? {
      imageId: a.imageId, setId: a.setId, attempts: 0, correct: 0, wrong: 0,
      rtSamples: [], meanRt: 0, medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    const samples = a.verdict === 'skip' ? base.rtSamples : [...base.rtSamples, a.rtMs].slice(-MAX_SAMPLES);
    const next: ImageStat = {
      ...base,
      attempts: base.attempts + (a.verdict === 'skip' ? 0 : 1),
      correct: base.correct + (a.verdict === 'correct' ? 1 : 0),
      wrong: base.wrong + (a.verdict === 'wrong' ? 1 : 0),
      rtSamples: samples,
      meanRt: Math.round(mean(samples)),
      medianRt: Math.round(median(samples)),
      wrongStreak: a.verdict === 'wrong' ? base.wrongStreak + 1 : a.verdict === 'correct' ? 0 : base.wrongStreak,
      lastSeenAt: a.shownAt,
    };
    await db.imageStats.put(next);
  });
}

/** 실전 오답에서 나온 혼동도 이미지 통계에 반영한다(오답 1회로 계산). */
export async function markRecallWrong(imageId: string, setId: string, at: number): Promise<void> {
  const prev = await db.imageStats.get(imageId);
  const base: ImageStat = prev ?? {
    imageId, setId, attempts: 0, correct: 0, wrong: 0,
    rtSamples: [], meanRt: 0, medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
  };
  await db.imageStats.put({
    ...base,
    attempts: base.attempts + 1,
    wrong: base.wrong + 1,
    wrongStreak: base.wrongStreak + 1,
    lastSeenAt: at,
  });
}
