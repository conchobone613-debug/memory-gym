import { db, type DrillAttempt, type ImageStat } from './db';
import { mean, median } from '../lib/srs';

const MAX_SAMPLES = 30;

/**
 * 시도 1건을 원시 저장하고 파생 통계를 갱신한다. 두 쓰기는 한 트랜잭션으로 묶는다.
 *
 * 갱신 **직전의 통계**를 돌려준다. 회장이 판정을 잘못 누르고 뒤로 가실 때 이 값을 그대로
 * 되돌려 놓으면 된다. 원시 기록에서 다시 계산하는 것보다 정확하고 싸다 — 되돌리는 순서가
 * 항상 넣은 역순이라 어긋날 일이 없다.
 */
export async function recordAttempt(a: DrillAttempt): Promise<ImageStat | undefined> {
  return db.transaction('rw', db.drillAttempts, db.imageStats, async () => {
    await db.drillAttempts.add(a);
    const prev = await db.imageStats.get(a.imageId);
    const base: ImageStat = prev ?? {
      imageId: a.imageId, setId: a.setId, attempts: 0, correct: 0, wrong: 0,
      rtSamples: [], meanRt: 0, medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    /*
     * rtMs 0 = '모름' 으로 넘긴 문항. 0 을 표본에 넣으면 중앙 반응시간이 거짓으로 빨라지고,
     * 포기까지 걸린 시간을 넣으면 회상 속도가 아니라 인내심을 재게 된다. 그래서 뺀다.
     * rebuild.ts 의 재계산도 같은 규칙이어야 한다.
     */
    const samples = a.verdict === 'skip' || a.rtMs <= 0
      ? base.rtSamples
      : [...base.rtSamples, a.rtMs].slice(-MAX_SAMPLES);
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
    return prev;
  });
}

/** 바로 앞 시도를 없던 일로 한다. 원시 기록을 지우고 통계는 찍어 둔 직전 값으로 되돌린다. */
export async function undoAttempt(attemptId: string, imageId: string, prev?: ImageStat): Promise<void> {
  await db.transaction('rw', db.drillAttempts, db.imageStats, async () => {
    await db.drillAttempts.delete(attemptId);
    if (prev) await db.imageStats.put(prev);
    else await db.imageStats.delete(imageId);
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
