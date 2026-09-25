import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_SETTINGS } from '../db/db';
import {
  buildSummary, claimAutoAsk, courseHref, courseRowsOn, courseStep, saveCourse, todayCourse, usageThisMonth, type Course, type CourseItem,
} from '../coach';
import { coachErrorText } from './CoachReview';
import { courseJob, defaultCourseMinutes, labelParts, markOpened, minuteOptions, nextCourseIndex, startCourseJob } from './course';

/* 코스 화면이 쓰는 계산 — 다음 항목 · 기본 분량 · 시간 고르기 · 카드 제목 나누기 · 짜는 중 상태와 하던 코스 지키기 */

describe('nextCourseIndex', () => {
  it('처음부터 아직 안 한 첫 항목', () => {
    expect(nextCourseIndex([null, null, null])).toBe(0);
    expect(nextCourseIndex(['a', null, null])).toBe(1);
    expect(nextCourseIndex(['a', 'b', 'c'])).toBe(-1);
    expect(nextCourseIndex([])).toBe(-1);
  });

  it('방금 끝낸 항목 다음부터 찾고, 앞에 건너뛴 것이 있으면 되돌아간다', () => {
    expect(nextCourseIndex(['a', 'b', null], 1)).toBe(2);
    expect(nextCourseIndex([null, 'b', 'c'], 2)).toBe(0);
    expect(nextCourseIndex([null, 'b', null], 1)).toBe(2);
    /* 방금 끝낸 칸은 다시 고르지 않는다(아직 저장 전이라 null 이어도) */
    expect(nextCourseIndex(['a', null, 'c'], 1)).toBe(-1);
  });
});

describe('기본 분량과 시간 고르기', () => {
  it('하루 목표에서 오늘 채운 분을 빼고, 최소 5분', () => {
    expect(defaultCourseMinutes(15, 0)).toBe(15);
    expect(defaultCourseMinutes(15, 3 * 60_000 + 59_000)).toBe(12);
    expect(defaultCourseMinutes(15, 14 * 60_000)).toBe(5);
    expect(defaultCourseMinutes(15, 90 * 60_000)).toBe(5);
    expect(defaultCourseMinutes(45, 0)).toBe(45);
  });

  it('지금 분량이 목록에 없으면 끼워 넣는다', () => {
    expect(minuteOptions(15)).toEqual([5, 10, 15, 20, 30]);
    expect(minuteOptions(12)).toEqual([5, 10, 12, 15, 20, 30]);
    expect(minuteOptions(45)).toEqual([5, 10, 15, 20, 30, 45]);
    expect(minuteOptions()).toEqual([5, 10, 15, 20, 30]);
  });
});

describe('labelParts', () => {
  it('카드 제목은 종목·칸까지, 분량은 아래 줄로', () => {
    expect(labelParts({ kind: 'basics', stage: 2, items: 30 })).toEqual(['기초 2단계 · 두 자리', '30문항']);
    expect(labelParts({ kind: 'basics', stage: 3, items: 20, pick: 'weak' })).toEqual(['기초 3단계 · 이미지', '20문항 · 약한 칸']);
    expect(labelParts({ kind: 'calendar', level: 4, items: 20, steps: true })).toEqual(['달력 4칸 · 전체 범위', '20문항 · 단계 입력']);
    expect(labelParts({ kind: 'calendar', level: 5, items: 0 })).toEqual(['달력 5칸 · 1분 모의 대회', '']);
    expect(labelParts({ kind: 'event', eventId: 'speed-numbers', run: 'easy' })).toEqual(['스피드 숫자 · 연습', '']);
  });
});

describe('코스 주소 왕복', () => {
  it('화면이 주소에서 읽는 값이 코스 항목과 같다', () => {
    const items: CourseItem[] = [
      { kind: 'basics', stage: 3, items: 25, pick: 'unseen' },
      { kind: 'basics', stage: 1, items: 20 },
      { kind: 'calendar', level: 3, items: 15, steps: true },
      { kind: 'calendar', level: 5, items: 0 },
      { kind: 'event', eventId: 'speed-cards', run: 'real' },
    ];
    items.forEach((it, i) => {
      const href = courseHref(it, 'row-1', i);
      const q = new URLSearchParams(href.split('?')[1]);
      expect(courseStep(q)).toEqual({ logId: 'row-1', index: i });
      if (it.kind === 'basics') {
        expect(href.startsWith('/basics?')).toBe(true);
        expect(q.get('stage')).toBe(String(it.stage));
        expect(Number(q.get('n'))).toBe(it.items);
        expect(q.get('pick')).toBe(it.pick ?? null);
      } else if (it.kind === 'calendar') {
        expect(href.startsWith('/calc/calendar/run?')).toBe(true);
        if (it.level === 5) expect(q.get('mode')).toBe('contest');
        else {
          expect(q.get('level')).toBe(String(it.level));
          expect(Number(q.get('n'))).toBe(it.items);
          expect(q.get('steps')).toBe(it.steps ? '1' : null);
        }
      } else {
        expect(href.startsWith('/practice?')).toBe(true);
        expect(q.get('preset')).toBe('c52');
        expect(q.get('event')).toBe('speed-cards');
        expect(q.get('run')).toBe('real');
      }
    });
  });
});

describe('코스 짜기 — 늦게 온 새 코스가 하던 코스를 밀어내지 않는다', () => {
  const course: Course = { say: '해 보세.', items: [{ kind: 'basics', stage: 1, items: 20, estMinutes: 1, why: '익힙니다.' }] };
  const summary = buildSummary({
    now: Date.now(), dailyMinutes: 15, summaries: [], goals: [], calLog: { sessions: [], items: [] }, contestSec: 60, slowImages: [],
  });
  const aiReply = () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({
      say: '기초 1단계부터 해 보세.',
      items: [{ kind: 'basics', stage: 1, level: 0, eventId: 'none', run: 'none', pick: 'none', items: 30, steps: false, why: '첫 단계를 익힙니다.' }],
    }) }],
    stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 80 },
  }), { status: 200 });

  beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });
  afterEach(() => vi.unstubAllGlobals());

  it('짜는 동안만 courseJob 이 있고, 새 행이 오늘의 코스가 된다', async () => {
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    const job = startCourseJob(10, false, base);
    expect(courseJob()).toBe(job);
    const row = await job.promise;
    expect(courseJob()).toBeNull();
    expect(row.id).not.toBe(base.id);
    expect((await todayCourse())?.id).toBe(row.id);
  });

  it('묻는 사이 홈에서 하던 코스를 열었으면 새 행은 그 뒤로 — 쓴 토큰은 그대로 센다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    vi.stubGlobal('fetch', vi.fn(async () => aiReply()));
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    const job = startCourseJob(15, true, base);
    markOpened(base.id);
    expect((await job.promise).id).toBe(base.id);
    expect((await todayCourse())?.id).toBe(base.id);
    const ai = (await db.coachLogs.toArray()).find((r) => r.source === 'ai')!;
    expect(ai.at).toBe(base.at - 1);
    expect(await usageThisMonth()).toMatchObject({ calls: 1, inputTokens: 400, outputTokens: 80 });
  });

  it('짜기 전에 열었던 코스는 지키지 않는다(다시 짜기를 누른 것은 새 코스를 바란 것)', async () => {
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    markOpened(base.id, Date.now() - 500);
    const row = await startCourseJob(20, false, base).promise;
    expect((await todayCourse())?.id).toBe(row.id);
    expect(row.minutes).toBe(20);
  });

  it('갈아 끼운 코스·뒤로 물린 코스에는 밀려남을 적는다', async () => {
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    const row = await startCourseJob(20, false, base).promise;
    expect(await db.coachLogs.get(base.id)).toMatchObject({ superseded: true });
    expect((await db.coachLogs.get(row.id))?.superseded).toBeUndefined();

    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    vi.stubGlobal('fetch', vi.fn(async () => aiReply()));
    const job = startCourseJob(15, true, row);
    markOpened(row.id);
    expect((await job.promise).id).toBe(row.id);
    const ai = (await db.coachLogs.toArray()).find((r) => r.source === 'ai')!;
    expect(ai.superseded).toBe(true);
    expect((await db.coachLogs.get(row.id))?.superseded).toBeUndefined();
  });

  it('하루 1회 자동 호출은 창이 둘이어도 한 번 — 자리를 먼저 잡은 쪽만 묻는다', async () => {
    const settings = { aiKey: 'sk-test' };
    const [a, b] = await Promise.all([claimAutoAsk(settings, { calls: 0 }), claimAutoAsk(settings, { calls: 0 })]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    /* 자리표는 호출 1회로 세고, 오늘의 코스로는 보이지 않는다 */
    expect((await usageThisMonth()).calls).toBe(1);
    expect(await todayCourse()).toBeUndefined();
    expect(await claimAutoAsk(settings, { calls: 1 })).toBeNull();

    /* 다른 창이 이미 자리를 잡았으면 묻지 않고 하던 코스를 돌려준다 */
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    const f = vi.fn(async () => aiReply());
    vi.stubGlobal('fetch', f);
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    expect((await startCourseJob(15, true, base, { settings, usage: { calls: 1 } }).promise).id).toBe(base.id);
    expect(f).not.toHaveBeenCalled();
  });

  it('자리를 잡은 쪽은 답이 오면 그 자리표 행을 채운다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    vi.stubGlobal('fetch', vi.fn(async () => aiReply()));
    const base = await saveCourse({ course, source: 'rule', minutes: 15, input: summary, now: Date.now() - 1000 });
    const row = await startCourseJob(15, true, base, { settings: { aiKey: 'sk-test' }, usage: { calls: 0 } }).promise;
    expect(row).toMatchObject({ source: 'ai', inputTokens: 400 });
    expect((await courseRowsOn()).filter((r) => r.source === 'ai')).toHaveLength(1);
    expect((await todayCourse())?.id).toBe(row.id);
    expect((await usageThisMonth()).calls).toBe(1);
  });
});

describe('coachErrorText', () => {
  it('오류 문구 뒤에 붙은 API 원문(영어·JSON)은 떼고 한국어만', () => {
    expect(coachErrorText(new Error('AI 가 응답하지 않았습니다 (529). {"type":"error","error":{"type":"overloaded_error"}}')))
      .toBe('AI 가 응답하지 않았습니다 (529).');
    expect(coachErrorText(new Error('AI 가 응답하지 않았습니다 (500). Internal Server Error'))).toBe('AI 가 응답하지 않았습니다 (500).');
    expect(coachErrorText(new Error('AI 답을 읽지 못했습니다. {"say":"해 보세.","items":[{"why":"익힙니다.'))).toBe('AI 답을 읽지 못했습니다.');
    expect(coachErrorText(new TypeError('Failed to fetch'))).toBe('스승님과 연결하지 못했습니다. 인터넷 연결을 확인해 주십시오.');
    expect(coachErrorText('키가 거부되었습니다. 설정에서 다시 확인해 주십시오.')).toBe('키가 거부되었습니다. 설정에서 다시 확인해 주십시오.');
  });
});
