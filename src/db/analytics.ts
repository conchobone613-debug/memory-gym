import { compareKeys, db, getSettings, type MemoImage } from './db';
import { median } from '../lib/srs';
import { bitsToKey, DEFAULT_BINARY_CODE } from '../lib/binary';
import { settingsForSession } from '../lib/resolveImage';

export function localDayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DayRow {
  day: string;
  attempts: number;
  correct: number;
  accuracy: number;
  medianRt: number;
  practiceSessions: number;
}

export async function dailyRows(days: number): Promise<DayRow[]> {
  const since = Date.now() - days * 86_400_000;
  const [attempts, sessions] = await Promise.all([
    db.drillAttempts.where('shownAt').above(since).toArray(),
    db.recallSessions.where('startedAt').above(since).toArray(),
  ]);
  const map = new Map<string, { rts: number[]; correct: number; attempts: number; practice: number }>();
  const bucket = (d: string) => {
    let b = map.get(d);
    if (!b) { b = { rts: [], correct: 0, attempts: 0, practice: 0 }; map.set(d, b); }
    return b;
  };
  for (const a of attempts) {
    if (a.verdict === 'skip') continue;
    const b = bucket(localDayKey(a.shownAt));
    b.attempts++;
    if (a.verdict === 'correct') { b.correct++; b.rts.push(a.rtMs); }
  }
  for (const s of sessions) bucket(localDayKey(s.startedAt)).practice++;

  const out: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = localDayKey(Date.now() - i * 86_400_000);
    const b = map.get(day);
    out.push({
      day,
      attempts: b?.attempts ?? 0,
      correct: b?.correct ?? 0,
      accuracy: b && b.attempts ? b.correct / b.attempts : 0,
      medianRt: b ? Math.round(median(b.rts)) : 0,
      practiceSessions: b?.practice ?? 0,
    });
  }
  return out;
}

export interface ConfusionPair { expected: string; answered: string; count: number; source: string }

/** 혼동 쌍: 실전 오답 칸 + 드릴 타이핑 오답에서 모은다. 별도 테이블 없이 조회 시점에 집계. */
export async function confusionPairs(limit = 10): Promise<ConfusionPair[]> {
  const cells = await db.recallCells.filter((c) => !c.isCorrect && c.answered !== '').toArray();
  const counts = new Map<string, ConfusionPair>();
  const bump = (expected: string, answered: string, source: string) => {
    const k = `${expected}>${answered}`;
    const cur = counts.get(k);
    if (cur) cur.count++;
    else counts.set(k, { expected, answered, count: 1, source });
  };
  /* 이진수 칸은 그 판 방식으로 이미지 키로 바꿔 센다 — 비트 문자열을 혼동 쌍에 섞지 않는다 */
  const settings = await getSettings();
  const binary = new Map((await db.recallSessions.where('mode').equals('binary').toArray())
    .map((s) => [s.id, settingsForSession(settings, s).binaryCode ?? DEFAULT_BINARY_CODE]));
  for (const c of cells) {
    const code = binary.get(c.sessionId);
    if (!code) { bump(c.expected, c.answered, '실전'); continue; }
    const exp = bitsToKey(c.expected, code);
    const ans = bitsToKey(c.answered, code);
    if (exp && ans) bump(exp, ans, '실전');
  }

  /* 초성만 맞은 것도 센다 — 다른 칸 이름을 쳤는데 코드 앞자리가 겹치면 그쪽으로 분류되기 때문 */
  const typed = await db.drillAttempts
    .filter((a) => !!a.typedInput && (a.typedMatch === 'none' || a.typedMatch === 'chosung'))
    .toArray();
  const images = await db.images.toArray();
  const byName = new Map(images.filter((i) => i.name).map((i) => [i.name.replace(/\s+/g, ''), i]));
  for (const a of typed) {
    const other = byName.get((a.typedInput ?? '').replace(/\s+/g, ''));
    if (other && other.key !== a.key) bump(a.key, other.key, '드릴');
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export interface HeatCell { key: string; image?: MemoImage; medianRt: number; attempts: number; errRate: number }

export async function heatmap(setId: string): Promise<HeatCell[]> {
  const set = await db.imageSets.get(setId);
  const images = await db.images.where('setId').equals(setId).toArray();
  const stats = await db.imageStats.where('setId').equals(setId).toArray();
  const byId = new Map(stats.map((s) => [s.imageId, s]));
  return images
    .sort((a, b) => compareKeys(set?.domain ?? 'custom', a.key, b.key))
    .map((image) => {
      const s = byId.get(image.id);
      return {
        key: image.key,
        image,
        medianRt: s?.medianRt ?? 0,
        attempts: s?.attempts ?? 0,
        errRate: s && s.attempts ? s.wrong / s.attempts : 0,
      };
    });
}

export interface MoverRow { key: string; name: string; medianRt: number; attempts: number; errRate: number }

/** 최근 7일 기준 가장 느린 / 가장 많이 틀린 이미지 */
export async function movers(limit = 5): Promise<{ slowest: MoverRow[]; worst: MoverRow[] }> {
  const images = await db.images.filter((i) => !!i.name).toArray();
  const byId = new Map(images.map((i) => [i.id, i]));
  const stats = (await db.imageStats.toArray()).filter((s) => s.attempts > 0 && byId.has(s.imageId));
  const row = (s: (typeof stats)[number]): MoverRow => {
    const img = byId.get(s.imageId)!;
    return { key: img.key, name: img.name, medianRt: s.medianRt, attempts: s.attempts, errRate: s.wrong / s.attempts };
  };
  return {
    slowest: stats.filter((s) => s.rtSamples.length > 0).sort((a, b) => b.medianRt - a.medianRt).slice(0, limit).map(row),
    worst: stats.filter((s) => s.wrong > 0).sort((a, b) => b.wrong / b.attempts - a.wrong / a.attempts).slice(0, limit).map(row),
  };
}

export interface MappingCell { unit: string; attempts: number; accuracy: number; medianRt: number }

/** 초급 단계 숙련도. 어느 숫자가 아직 안 붙었는지 한눈에 보려는 것. */
export async function mappingCells(stage: 1 | 2): Promise<MappingCell[]> {
  const rows = await db.mappingStats.where('stage').equals(stage).toArray();
  const byUnit = new Map(rows.map((r) => [r.unit, r]));
  const units = stage === 1
    ? Array.from({ length: 10 }, (_, i) => String(i))
    : Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
  return units.map((unit) => {
    const r = byUnit.get(unit);
    return {
      unit,
      attempts: r?.attempts ?? 0,
      accuracy: r && r.attempts ? r.correct / r.attempts : 0,
      medianRt: r?.medianRt ?? 0,
    };
  });
}
