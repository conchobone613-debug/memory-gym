import { db, getSettings, type ImageStat, type MappingStat } from './db';
import { resolveCellImage, settingsForSession } from '../lib/resolveImage';
import { mean, median } from '../lib/srs';

const MAX_SAMPLES = 30;

/**
 * 파생 통계를 원시 기록에서 다시 계산한다.
 *
 * 기기 간 동기화에서 통계를 그대로 주고받으면 안 된다 — 두 기기가 각자 센 횟수를 합치면
 * 숫자가 부풀거나 덮어써진다. 원시 기록(drillAttempts)만 합치고 통계는 여기서 다시 만든다.
 * 통계가 이상해졌을 때 손으로 고치는 수단으로도 쓴다.
 */
export async function rebuildImageStats(): Promise<number> {
  const attempts = (await db.drillAttempts.toArray()).sort((a, b) => a.shownAt - b.shownAt);
  const byImage = new Map<string, ImageStat>();

  for (const a of attempts) {
    if (a.verdict === 'skip') continue;
    const cur = byImage.get(a.imageId) ?? {
      imageId: a.imageId, setId: a.setId, attempts: 0, correct: 0, wrong: 0,
      rtSamples: [], meanRt: 0, medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    cur.attempts += 1;
    if (a.verdict === 'correct') cur.correct += 1;
    if (a.verdict === 'wrong') cur.wrong += 1;
    /* record.ts 와 같은 규칙 — 반응시간이 없는 '모름' 은 표본에서 뺀다 */
    if (a.rtMs > 0) cur.rtSamples = [...cur.rtSamples, a.rtMs].slice(-MAX_SAMPLES);
    cur.wrongStreak = a.verdict === 'wrong' ? cur.wrongStreak + 1 : 0;
    cur.lastSeenAt = Math.max(cur.lastSeenAt, a.shownAt);
    byImage.set(a.imageId, cur);
  }

  /*
   * 실전에서 틀린 칸도 오답으로 세어야 한다. 그 기록은 drillAttempts 가 아니라 recallCells 에
   * 있어서, 여기서 같이 접지 않으면 통계를 다시 만들 때마다 실전 오답이 사라진다.
   */
  const [settings, sets, images, sessions] = await Promise.all([
    getSettings(), db.imageSets.toArray(), db.images.toArray(), db.recallSessions.toArray(),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  for (const cell of await db.recallCells.toArray()) {
    if (cell.isCorrect) continue;
    const session = sessionById.get(cell.sessionId);
    if (!session) continue;
    const chunk = session.mode === 'digits' ? cell.expected.length : 1;
    const img = resolveCellImage(cell.expected, session.mode, chunk, settingsForSession(settings, session), sets, images);
    if (!img?.name.trim()) continue;
    const cur = byImage.get(img.id) ?? {
      imageId: img.id, setId: img.setId, attempts: 0, correct: 0, wrong: 0,
      rtSamples: [], meanRt: 0, medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    cur.attempts += 1;
    cur.wrong += 1;
    cur.wrongStreak += 1;
    cur.lastSeenAt = Math.max(cur.lastSeenAt, session.endedAt ?? session.startedAt);
    byImage.set(img.id, cur);
  }

  const rows = [...byImage.values()].map((s) => ({
    ...s,
    meanRt: Math.round(mean(s.rtSamples)),
    medianRt: Math.round(median(s.rtSamples)),
  }));

  await db.transaction('rw', db.imageStats, async () => {
    await db.imageStats.clear();
    if (rows.length) await db.imageStats.bulkPut(rows);
  });
  return rows.length;
}

/** 초급 단계 통계도 같은 이유로 원시 기록에서 다시 만든다. */
export async function rebuildMappingStats(): Promise<number> {
  const attempts = (await db.mappingAttempts.toArray()).sort((a, b) => a.shownAt - b.shownAt);
  const byKey = new Map<string, MappingStat>();

  for (const a of attempts) {
    const key = `s${a.stage}:${a.unit}`;
    const cur = byKey.get(key) ?? {
      key, stage: a.stage, unit: a.unit,
      attempts: 0, correct: 0, wrong: 0, rtSamples: [], medianRt: 0, wrongStreak: 0, lastSeenAt: 0,
    };
    cur.attempts += 1;
    if (a.isCorrect) cur.correct += 1; else cur.wrong += 1;
    if (a.rtMs > 0) cur.rtSamples = [...cur.rtSamples, a.rtMs].slice(-20);
    cur.wrongStreak = a.isCorrect ? 0 : cur.wrongStreak + 1;
    cur.lastSeenAt = Math.max(cur.lastSeenAt, a.shownAt);
    byKey.set(key, cur);
  }

  const rows = [...byKey.values()].map((r) => ({ ...r, medianRt: Math.round(median(r.rtSamples)) }));

  await db.transaction('rw', db.mappingStats, async () => {
    await db.mappingStats.clear();
    if (rows.length) await db.mappingStats.bulkPut(rows);
  });
  return rows.length;
}

export async function rebuildAll(): Promise<{ images: number; mapping: number }> {
  return { images: await rebuildImageStats(), mapping: await rebuildMappingStats() };
}
