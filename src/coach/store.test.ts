import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_SETTINGS } from '../db/db';
import { buildSessionReviewInput } from './review';
import { courseRowsOn, markStep, saveCourse, todayCourse, usageThisMonth } from './store';
import { ensureTodayCourse, makeCourse, reviewSession } from './index';
import { buildSummary } from './summary';
import type { Course } from './types';

/* 저장소를 거치는 길 — 코스 행 · 진행 표시 · 사용량 · 자동 호출 한 번 · 복기 입력. 실제 API 는 부르지 않는다. */

const course: Course = {
  say: '해 보세.',
  items: [
    { kind: 'basics', stage: 1, items: 20, estMinutes: 1, why: '익힙니다.' },
    { kind: 'calendar', level: 1, items: 20, estMinutes: 2, why: '익힙니다.' },
  ],
};
const summary = buildSummary({
  now: Date.now(), dailyMinutes: 15, summaries: [], goals: [], calLog: { sessions: [], items: [] }, contestSec: 60, slowImages: [],
});

const aiCourse = JSON.stringify({
  say: '기초 1단계부터 해 보세.',
  items: [{ kind: 'basics', stage: 1, level: 0, eventId: 'none', run: 'none', pick: 'none', items: 30, steps: false, why: '첫 단계를 익힙니다.' }],
});
const stubFetch = (res: () => Response) => {
  const f = vi.fn(async (_url: string, _init: RequestInit) => res());
  vi.stubGlobal('fetch', f);
  return f;
};
const okReply = (text: string) => () => new Response(JSON.stringify({
  content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 80 },
}), { status: 200 });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});
afterEach(() => vi.unstubAllGlobals());

describe('코스 행', () => {
  it('남기고, 오늘 것을 찾고, 항목을 끝낼 때마다 표시한다', async () => {
    const row = await saveCourse({ course, source: 'rule', minutes: 15, input: summary });
    expect(await todayCourse()).toMatchObject({ id: row.id, source: 'rule', done: [null, null], followed: false });

    expect(await markStep(row.id, 0, 'sess-a')).toMatchObject({ done: ['sess-a', null], followed: false });
    expect(await markStep(row.id, 5, 'sess-x')).toBeUndefined(); // 없는 순번
    expect(await markStep(row.id, 1, 'sess-b')).toMatchObject({ done: ['sess-a', 'sess-b'], followed: true });
    expect(await db.coachLogs.get(row.id)).toMatchObject({ done: ['sess-a', 'sess-b'], followed: true });
  });

  it('그 판의 실제 설정이 항목과 다르면 적지 않는다', async () => {
    const row = await saveCourse({ course, source: 'rule', minutes: 15, input: summary });
    expect(await markStep(row.id, 1, 'sess-x', { kind: 'calendar', level: 3, steps: false })).toBeUndefined();
    expect((await db.coachLogs.get(row.id))?.done).toEqual([null, null]);
    expect(await markStep(row.id, 1, 'sess-y', { kind: 'calendar', level: 1, steps: false })).toMatchObject({ done: [null, 'sess-y'] });
  });

  it('계산 종목 항목을 플래시 암산으로 한 판은 적지 않는다', async () => {
    const calc: Course = { say: '해 보세.', items: [{ kind: 'calc', eventId: 'addition', level: 1, items: 20, estMinutes: 4, why: '익힙니다.' }] };
    const row = await saveCourse({ course: calc, source: 'rule', minutes: 15, input: summary });
    expect(await markStep(row.id, 0, 'sess-f', { kind: 'calc', eventId: 'addition', level: 1, flash: true })).toBeUndefined();
    expect(await db.coachLogs.get(row.id)).toMatchObject({ done: [null], followed: false });
    expect(await markStep(row.id, 0, 'sess-p', { kind: 'calc', eventId: 'addition', level: 1, flash: false })).toMatchObject({ done: ['sess-p'], followed: true });
  });

  it('어제 코스는 오늘 코스가 아니다', async () => {
    await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 86_400_000 });
    expect(await todayCourse()).toBeUndefined();
  });

  it('이번 달 사용량', async () => {
    await saveCourse({ course, source: 'ai', minutes: 15, input: summary, usage: { input: 1000, output: 200 } });
    await saveCourse({ course, source: 'rule', minutes: 15, input: summary });
    expect(await usageThisMonth()).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 200 });
  });
});

describe('오늘의 코스 짜기', () => {
  it('키가 없으면 규칙 코치 — 부르지 않는다', async () => {
    const f = stubFetch(okReply(aiCourse));
    const row = await makeCourse({ useAi: true });
    expect(row).toMatchObject({ source: 'rule', minutes: 15 });
    expect(row.aiError).toBeUndefined();
    expect(row.course!.items.length).toBeGreaterThan(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('키가 있으면 하루 한 번 스승님께 묻는다 — 동시에 두 번 불려도 한 번', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    const f = stubFetch(okReply(aiCourse));
    const [a, b] = await Promise.all([ensureTodayCourse(), ensureTodayCourse()]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ source: 'ai', inputTokens: 400, outputTokens: 80 });
    expect(a.course!.items[0]).toMatchObject({ kind: 'basics', stage: 1, why: '첫 단계를 익힙니다.' });
    expect((a.course!.items[0] as { items: number }).items).toBeGreaterThanOrEqual(30); // 분량을 코드가 채운다
    expect(f).toHaveBeenCalledTimes(1);

    /* 다시 열어도 새로 묻지 않는다 */
    expect((await ensureTodayCourse()).id).toBe(a.id);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('스승님이 실패하면 규칙 코스를 남기고, 같은 날 다시 자동으로 묻지 않는다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    const f = stubFetch(() => new Response('{}', { status: 401 }));
    const row = await ensureTodayCourse();
    expect(row).toMatchObject({ source: 'rule', aiError: '키가 거부되었습니다. 설정에서 다시 확인해 주십시오.' });
    expect((await ensureTodayCourse()).id).toBe(row.id);
    expect(f).toHaveBeenCalledTimes(1);
    expect((await usageThisMonth()).calls).toBe(1);
  });

  it('스승님 답에 쓸 항목이 없으면 규칙 코스로, 쓴 토큰은 남긴다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    stubFetch(okReply(JSON.stringify({ say: '해 보세.', items: [] })));
    const row = await makeCourse({ useAi: true });
    expect(row).toMatchObject({ source: 'rule', inputTokens: 400, outputTokens: 80 });
    expect(row.aiError).toContain('규칙 코치');
    expect((await courseRowsOn()).length).toBe(1);
  });
});

describe('한 판 복기', () => {
  const t = Date.now() - 3600_000;
  async function seedMapping() {
    await db.mappingSessions.bulkAdd([
      { id: 'old', stage: 1, startedAt: t - 86_400_000, itemCount: 2 },
      { id: 'new', stage: 1, startedAt: t, itemCount: 3 },
    ]);
    const base = { stage: 1 as const, direction: 'toConsonant' as const };
    await db.mappingAttempts.bulkAdd([
      { ...base, id: 'o1', sessionId: 'old', order: 0, unit: '1', prompt: '1', answer: 'ㄱ', given: 'ㄴ', isCorrect: false, rtMs: 2000, shownAt: t - 86_400_000 },
      { ...base, id: 'o2', sessionId: 'old', order: 1, unit: '2', prompt: '2', answer: 'ㄴ', given: 'ㄴ', isCorrect: true, rtMs: 2000, shownAt: t - 86_400_000 + 3000 },
      { ...base, id: 'n1', sessionId: 'new', order: 0, unit: '7', prompt: '7', answer: 'ㅅ', given: 'ㅅ', isCorrect: true, rtMs: 900, shownAt: t },
      { ...base, id: 'n2', sessionId: 'new', order: 1, unit: '8', prompt: '8', answer: 'ㅈ', given: 'ㅅ', isCorrect: false, rtMs: 2600, shownAt: t + 2000 },
      { ...base, id: 'n3', sessionId: 'new', order: 2, unit: '0', prompt: '0', answer: 'ㅇ', given: '', isCorrect: false, rtMs: 0, shownAt: t + 6000 },
    ]);
  }

  it('그 판의 요약만 — 느린 문항 · 틀린 문항 · 기준 · 지난 판', async () => {
    await seedMapping();
    const inp = await buildSessionReviewInput('mapping', 'new');
    expect(inp).toMatchObject({
      title: '기초 1단계', mode: 'practice', items: 3, correct: 1, accuracyPct: 33, secPerItem: 1.75,
      target: { accuracyPct: 95, sec: 1.5 },
      previous: { accuracyPct: 50, secPerItem: 2 },
    });
    expect(inp!.slowest).toEqual([{ prompt: '8', answer: 'ㅈ', sec: 2.6 }, { prompt: '7', answer: 'ㅅ', sec: 0.9 }]); // 모름(0)은 뺀다
    expect(inp!.wrong).toEqual([{ prompt: '8', expected: 'ㅈ', given: 'ㅅ' }, { prompt: '0', expected: 'ㅇ', given: '모름' }]);
    expect(await buildSessionReviewInput('mapping', 'nope')).toBeNull();
  });

  it('달력 판의 지난 판은 같은 칸·같은 단계 입력끼리만', async () => {
    const cal = (id: string, level: number, at: number, correct: number) => ({
      id, disciplineId: 'calendar', mode: 'practice' as const, rules: {}, params: { level, steps: 0 }, seed: 'x',
      startedAt: at, endedAt: at + 2000, correct, wrong: 2 - correct, score: correct,
    });
    const item = (sessionId: string, i: number, at: number, ok: boolean) => ({
      id: `${sessionId}-${i}`, sessionId, index: i, kind: 'year' as const, prompt: '1999', expected: '1', answered: ok ? '1' : '2',
      isCorrect: ok, rtMs: 1000, shownAt: at + i * 1000,
    });
    await db.calcSessions.bulkAdd([cal('l3-old', 3, t - 2 * 86_400_000, 1), cal('l1-mid', 1, t - 86_400_000, 2), cal('l3-new', 3, t, 2)]);
    await db.calcItems.bulkAdd([
      item('l3-old', 0, t - 2 * 86_400_000, true), item('l3-old', 1, t - 2 * 86_400_000, false),
      item('l1-mid', 0, t - 86_400_000, true), item('l1-mid', 1, t - 86_400_000, true),
      item('l3-new', 0, t, true), item('l3-new', 1, t, true),
    ]);
    /* 바로 앞 판은 1칸(100%)이지만 견줄 것은 같은 3칸의 지난 판(50%) */
    expect((await buildSessionReviewInput('calc', 'l3-new'))?.previous).toMatchObject({ accuracyPct: 50 });
  });

  it('덧셈 플래시 판은 같은 간격의 플래시 판끼리만 견주고, 칸의 통과 기준을 붙이지 않는다', async () => {
    const add = (id: string, at: number, correct: number, flashMs = 0) => ({
      id, disciplineId: 'addition', mode: 'practice' as const, rules: {},
      params: { level: 1, items: 2, ...(flashMs ? { flash: 1, intervalMs: flashMs } : {}) }, seed: 'x',
      startedAt: at, endedAt: at + 2000, correct, wrong: 2 - correct, score: correct,
    });
    const item = (sessionId: string, i: number, at: number, ok: boolean) => ({
      id: `${sessionId}-${i}`, sessionId, index: i, kind: 'add', prompt: '12 + 34', expected: '46', answered: ok ? '46' : '47',
      isCorrect: ok, rtMs: 1000, shownAt: at + i * 1000,
    });
    const rows = [
      add('f-old', t - 3 * 86_400_000, 1, 1000), add('f-other', t - 2 * 86_400_000, 0, 500),
      add('plain', t - 86_400_000, 2), add('f-new', t, 2, 1000), add('plain-new', t + 1000, 2),
    ];
    await db.calcSessions.bulkAdd(rows);
    await db.calcItems.bulkAdd(rows.flatMap((s) => [item(s.id, 0, s.startedAt, s.correct > 0), item(s.id, 1, s.startedAt, s.correct > 1)]));
    const f = await buildSessionReviewInput('calc', 'f-new');
    expect(f?.previous).toMatchObject({ accuracyPct: 50 }); // 1.0초 플래시 판(f-old), 0.5초 판·보통 판은 건너뛴다
    expect(f?.target).toBeUndefined();
    const p = await buildSessionReviewInput('calc', 'plain-new');
    expect(p?.previous).toMatchObject({ accuracyPct: 100 }); // 보통 판(plain), 바로 앞 플래시 판은 건너뛴다
    expect(p?.target).toEqual({ accuracyPct: 90, sec: 10 });
  });

  it('받은 복기는 남겨 두고 다시 부르지 않는다', async () => {
    await seedMapping();
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    const f = stubFetch(okReply(JSON.stringify({
      say: '정확도 33%로 지난 판 50%보다 낮았네. 8 칸이 2.6초로 가장 느렸으니 눈여겨보게.',
      next: '8 칸을 먼저 봅니다.',
    })));
    const a = await reviewSession('mapping', 'new');
    expect(a.review).toEqual({ say: '정확도 33%로 지난 판 50%보다 낮았네. 8 칸이 2.6초로 가장 느렸으니 눈여겨보게.', next: '8 칸을 먼저 봅니다.' });
    expect((await reviewSession('mapping', 'new')).id).toBe(a.id);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
