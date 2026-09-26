import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_SETTINGS } from '../db/db';
import type { SessionSummary } from '../db/sessions';
import type { Weakness } from '../db/insights';
import { buildWeeklyInput, receivedThisWeek, ruleWeekly, weekRange, type WeeklyInput } from './weekly';
import { allowedIn, keepSentences, numbersOk, validateWeekly } from './validate';
import { WEEKLY_SYSTEM, weeklyUser } from './prompts';
import { latestWeekly, saveWeekly, usageThisMonth } from './store';
import { weeklyReview } from './index';

/* 스승님 주간 리뷰 — 주간 표 · 규칙 요약 · 답 검사 · 저장 · 버튼 입구. 실제 API 는 부르지 않는다(가짜 fetch). */

const T = new Date(2026, 8, 26, 12, 0, 0).getTime(); // 2026-09-26 정오 (현지 시각)
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();

function run(o: Partial<SessionSummary> & Pick<SessionSummary, 'disciplineId' | 'startedAt'>): SessionSummary {
  const items = o.items ?? 10;
  const correct = o.correct ?? 9;
  return {
    id: `${o.disciplineId}-${o.startedAt}`, kind: 'calc', domain: 'calc', title: o.disciplineId, mode: 'practice',
    durationMs: 60_000, perItemMs: 1000, ...o, items, correct, accuracy: correct / items,
  };
}
const mem = (o: Parameters<typeof run>[0]) => run({ domain: 'memory', kind: 'recall', ...o });

const noWeak: Weakness = { memory: { slowImages: [], errorTags: [] }, calc: { calendarSteps: [], lowAccuracy: [] } };
const weak: Weakness = {
  memory: { slowImages: [{ key: '47', name: '사슴', sec: 2.8, n: 12 }], errorTags: [{ tag: 'image', name: '이미지 혼동', n: 4 }] },
  calc: {
    calendarSteps: [{ name: '월 코드', sec: 3.1, n: 40 }, { name: '요일', sec: 1.2, n: 40 }],
    lowAccuracy: [{ id: 'multiplication:4', name: '곱셈 5×5', accuracyPct: 70, n: 20 }],
  },
};

const summaries = [
  mem({ disciplineId: 'basics-1', kind: 'mapping', startedAt: at(20, 0, 30), durationMs: 20 * 60_000 }), // 이번 주 첫날
  mem({ disciplineId: 'basics-1', kind: 'mapping', startedAt: at(19, 23, 30), durationMs: 10 * 60_000, correct: 5 }), // 지난주 끝
  mem({ disciplineId: 'basics-1', kind: 'mapping', startedAt: at(24, 9), durationMs: 2 * 60_000, correct: 10 }),
  run({ disciplineId: 'multiplication', startedAt: at(26, 10), durationMs: 16 * 60_000, items: 20, correct: 15, perItemMs: 5000 }),
  run({ disciplineId: 'multiplication', mode: 'contest', startedAt: at(25, 20), durationMs: 5 * 60_000, score: 12 }),
  run({ disciplineId: 'multiplication', mode: 'contest', startedAt: at(14, 20), durationMs: 3 * 60_000, score: 8 }),
  mem({ disciplineId: 'spoken-numbers', mode: 'contest', startedAt: at(13, 0, 30), durationMs: 4 * 60_000, score: 20 }), // 지난주 첫날
  run({ disciplineId: 'calendar', startedAt: at(12, 23), durationMs: 50 * 60_000 }), // 지난주보다 앞 — 빠진다
];

describe('주간 표', () => {
  const inp = buildWeeklyInput(summaries, T, 15, weak);

  it('이번 주 = 오늘 포함 최근 7일, 지난주 = 그 앞 7일', () => {
    expect(inp.week).toEqual({ from: '2026-09-20', to: '2026-09-26' });
    const r = weekRange(T);
    expect([r.prevFrom, r.from, r.to]).toEqual([at(13, 0), at(20, 0), at(27, 0)]);
    expect(inp.domains).toEqual({
      memory: { minutes: 22, prevMinutes: 14, sessions: 2, prevSessions: 2 },
      calc: { minutes: 21, prevMinutes: 3, sessions: 2, prevSessions: 1 },
    });
    expect(inp.daily).toEqual({ goalMin: 15, daysMetGoal: 2, streak: 3 });
  });

  it('종목은 이번 주나 지난주에 판이 있는 것만, 등록부 순서', () => {
    expect(inp.disciplines).toEqual([
      {
        name: '기초 1단계', domain: '기억력', sessions: 2, prevSessions: 1, accuracyPct: 95, prevAccuracyPct: 50,
        secPerItem: 1, bestContest: null, prevBestContest: null,
      },
      {
        name: '듣고 외우는 숫자', domain: '기억력', sessions: 0, prevSessions: 1, accuracyPct: null, prevAccuracyPct: 90,
        secPerItem: null, bestContest: null, prevBestContest: 20, contestUnit: '자리',
      },
      {
        name: '곱셈', domain: '계산', sessions: 2, prevSessions: 1, accuracyPct: 80, prevAccuracyPct: 90,
        secPerItem: 3, bestContest: 12, prevBestContest: 8, contestUnit: '점',
      },
    ]);
  });

  it('약점은 사람이 읽는 줄로 — 달력 단계는 가장 느린 것 하나', () => {
    expect(inp.weak).toEqual([
      { area: '기억력', what: '느린 이미지', name: '47 사슴', n: 12, sec: 2.8 },
      { area: '기억력', what: '오답 원인', name: '이미지 혼동', n: 4 },
      { area: '계산', what: '달력 느린 단계', name: '월 코드', n: 40, sec: 3.1 },
      { area: '계산', what: '낮은 정확도', name: '곱셈 5×5', n: 20, accuracyPct: 70 },
    ]);
  });

  it('기록이 없으면 빈 표', () => {
    const empty = buildWeeklyInput([], T, 15, noWeak);
    expect(empty.disciplines).toEqual([]);
    expect(empty.domains.memory).toEqual({ minutes: 0, prevMinutes: 0, sessions: 0, prevSessions: 0 });
    expect(empty.daily).toEqual({ goalMin: 15, daysMetGoal: 0, streak: 0 });
  });
});

describe('규칙으로 쓴 주간 요약', () => {
  const inp = buildWeeklyInput(summaries, T, 15, weak);
  /** 스승님 답과 같은 검사를 통과하는가 — 숫자는 표에 있는 값만, 하게체 */
  const passes = (text: string, i: WeeklyInput) => keepSentences(text, allowedIn(weeklyUser(i), i)) === text;

  it('표에 있는 숫자만 — 지난주와의 차이는 숫자로 쓰지 않는다', () => {
    const text = ruleWeekly(inp);
    expect(text).toBe('이번 주 기억력 22분 · 계산 21분, 지난주보다 늘었네. 하루 목표 15분을 2일 채웠네.');
    expect(passes(text, inp)).toBe(true);
    expect(text).not.toContain('26'); // 이번 주 43분 − 지난주 17분 같은 새 숫자가 없다
  });

  it('줄었으면 줄었다고, 한 영역만 했으면 그 영역끼리만 견준다', () => {
    const less: WeeklyInput = {
      ...inp,
      daily: { goalMin: 20, daysMetGoal: 0, streak: 1 },
      domains: { memory: { minutes: 0, prevMinutes: 30, sessions: 0, prevSessions: 3 }, calc: { minutes: 12, prevMinutes: 5, sessions: 1, prevSessions: 1 } },
    };
    const text = ruleWeekly(less);
    // 계산만 적었으니 계산 12분을 지난주 계산 5분과 견준다 — 안 한 기억력 30분을 섞으면 '줄었네' 로 반대로 읽힌다
    expect(text).toBe('이번 주 계산 12분, 지난주보다 늘었네. 하루 목표 20분을 채운 날은 아직 없네.');
    expect(passes(text, less)).toBe(true);

    const memOnly: WeeklyInput = {
      ...less,
      domains: { memory: { minutes: 42, prevMinutes: 20, sessions: 3, prevSessions: 2 }, calc: { minutes: 0, prevMinutes: 30, sessions: 0, prevSessions: 2 } },
    };
    expect(ruleWeekly(memOnly)).toBe('이번 주 기억력 42분, 지난주보다 늘었네. 하루 목표 20분을 채운 날은 아직 없네.');
    expect(passes(ruleWeekly(memOnly), memOnly)).toBe(true);

    const bothLess: WeeklyInput = {
      ...less,
      domains: { memory: { minutes: 10, prevMinutes: 20, sessions: 1, prevSessions: 2 }, calc: { minutes: 5, prevMinutes: 10, sessions: 1, prevSessions: 1 } },
    };
    expect(ruleWeekly(bothLess)).toBe('이번 주 기억력 10분 · 계산 5분, 지난주보다 줄었네. 하루 목표 20분을 채운 날은 아직 없네.');

    // 지난주에는 기억력만, 이번 주에는 계산만 — 적은 영역(계산)의 지난주 판이 없으니 견주지 않는다
    const switched: WeeklyInput = { ...less, domains: { ...less.domains, calc: { ...less.domains.calc, prevSessions: 0, prevMinutes: 0 } } };
    expect(ruleWeekly(switched)).toBe('이번 주 계산 12분을 채웠네. 하루 목표 20분을 채운 날은 아직 없네.');

    const first: WeeklyInput = { ...less, domains: { ...less.domains, memory: { ...less.domains.memory, prevSessions: 0, prevMinutes: 0 }, calc: { ...less.domains.calc, prevSessions: 0, prevMinutes: 0 } } };
    expect(ruleWeekly(first)).toBe('이번 주 계산 12분을 채웠네. 하루 목표 20분을 채운 날은 아직 없네.');
  });

  it('기록이 없을 때', () => {
    const empty = buildWeeklyInput([], T, 15, noWeak);
    expect(empty.everPlayed).toBe(false);
    expect(ruleWeekly(empty)).toBe('아직 기록이 없네. 오늘 한 판부터 시작해 보세.');
    expect(passes(ruleWeekly(empty), empty)).toBe(true);
  });

  it('두 주 전보다 오래된 판만 있으면 기간을 한정해 말한다', () => {
    const old = buildWeeklyInput([run({ disciplineId: 'multiplication', startedAt: at(6, 10) })], T, 15, noWeak);
    expect(old.domains.calc).toEqual({ minutes: 0, prevMinutes: 0, sessions: 0, prevSessions: 0 });
    expect(old.everPlayed).toBe(true);
    expect(ruleWeekly(old)).toBe('요즘 두 주 동안은 기록이 없네. 오늘 한 판부터 다시 시작해 보세.');
    expect(passes(ruleWeekly(old), old)).toBe(true);
  });
});

describe('주간 리뷰 답 검사', () => {
  const inp = buildWeeklyInput(summaries, T, 15, weak);

  it('지어낸 숫자·하게체 아닌 문장을 빼고, focus 는 평문·표의 숫자만 최대 3개', () => {
    const out = validateWeekly({
      say: '이번 주 기억력 22분 · 계산 21분으로 지난주 14분 · 3분보다 늘었네. 지난주보다 26분이나 늘었구먼. 이번 주도 수고하셨습니다. 곱셈 5×5 정확도가 70%로 가장 낮으니 눈여겨보게.',
      focus: [
        '곱셈 5×5 칸을 먼저 풉니다.', '곱셈을 더 연습하게.', '매일 30분씩 훈련합니다.', '곱셈 5×5 칸을 먼저 풉니다.',
        '하루 목표 15분을 2일보다 더 채웁니다.', '달력 월 코드를 끊어 칩니다.', '느렸던 47 사슴 칸을 봅니다.', 42,
      ],
    }, inp);
    expect(out).toEqual({
      say: '이번 주 기억력 22분 · 계산 21분으로 지난주 14분 · 3분보다 늘었네. 곱셈 5×5 정확도가 70%로 가장 낮으니 눈여겨보게.',
      focus: ['곱셈 5×5 칸을 먼저 풉니다.', '하루 목표 15분을 2일보다 더 채웁니다.', '달력 월 코드를 끊어 칩니다.'],
    });
  });

  it('단위가 맞아야 받는다 — 2일은 목표 채운 날, 3.1초는 느린 단계', () => {
    const allowed = allowedIn(weeklyUser(inp), inp);
    expect(numbersOk('목표를 2일 채웠네.', allowed)).toBe(true);
    expect(numbersOk('월 코드가 3.1초일세.', allowed)).toBe(true);
    expect(numbersOk('월 코드가 3.1%일세.', allowed)).toBe(false);
    expect(numbersOk('정확도가 10%p 올랐네.', allowed)).toBe(false);
  });

  it('스승님 말이 하나도 남지 않으면 null, say 는 세 문장까지', () => {
    expect(validateWeekly({ say: '이번 주도 수고하셨습니다.', focus: ['곱셈 5×5 칸을 먼저 풉니다.'] }, inp)).toBeNull();
    expect(validateWeekly('글자', inp)).toBeNull();
    const four = validateWeekly({ say: '좋네. 잘했네. 더 해 보세. 쉬어도 되네.', focus: 'x' }, inp);
    expect(four).toEqual({ say: '좋네. 잘했네. 더 해 보세.', focus: [] });
  });

  it('프롬프트에 맞는 예와 틀린 예가 함께 있다', () => {
    expect(WEEKLY_SYSTEM).toContain('맞는 예');
    expect(WEEKLY_SYSTEM).toContain('틀린 예');
  });
});

describe('주간 리뷰 저장과 버튼', () => {
  const stubFetch = (res: () => Response) => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => res());
    vi.stubGlobal('fetch', f);
    return f;
  };
  const okReply = (body: unknown) => () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(body) }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 90 },
  }), { status: 200 });
  const good = { say: '이번 주 기억력 1분일세. 기초 1단계부터 다져 보세.', focus: ['기초 1단계를 먼저 봅니다.'] };

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const t = Date.now() - 3600_000;
    await db.mappingSessions.add({ id: 'm', stage: 1, startedAt: t, itemCount: 2 });
    const base = { sessionId: 'm', stage: 1 as const, direction: 'toConsonant' as const, rtMs: 1000 };
    await db.mappingAttempts.bulkAdd([
      { ...base, id: 'm1', order: 0, unit: '1', prompt: '1', answer: 'ㄱ', given: 'ㄱ', isCorrect: true, shownAt: t },
      { ...base, id: 'm2', order: 1, unit: '2', prompt: '2', answer: 'ㄴ', given: 'ㄷ', isCorrect: false, shownAt: t + 60_000 },
    ]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('최근 받은 리뷰 — 실패 행은 건너뛴다. 이번 주에 받았는지', async () => {
    const input = buildWeeklyInput([], T, 15, noWeak);
    const ok = await saveWeekly({ input, output: '{}', weekly: { say: '좋네.', focus: [] }, usage: { input: 10, output: 5 }, now: T - 3600_000 });
    await saveWeekly({ input, output: '', aiError: '실패', now: T });
    expect((await latestWeekly())?.id).toBe(ok.id);
    expect(receivedThisWeek(ok, T)).toBe(true);
    expect(receivedThisWeek({ at: T - 7 * 86_400_000 }, T)).toBe(false);
    expect(receivedThisWeek(undefined, T)).toBe(false);
  });

  it('키가 없으면 부르지 않는다', async () => {
    const f = stubFetch(okReply(good));
    await expect(weeklyReview()).rejects.toThrow('AI 키');
    expect(f).not.toHaveBeenCalled();
  });

  it('받은 리뷰를 남기고 사용량에 든다 — 한 곳(callJson)으로, 생각 끄고 부른다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    const f = stubFetch(okReply(good));
    const row = await weeklyReview();
    expect(row).toMatchObject({ kind: 'weekly', source: 'ai', inputTokens: 500, outputTokens: 90, weekly: good });
    expect(await latestWeekly()).toMatchObject({ id: row.id, weekly: good });
    expect(await usageThisMonth()).toMatchObject({ calls: 1, inputTokens: 500, outputTokens: 90 });

    const body = JSON.parse(f.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ model: 'claude-sonnet-5', thinking: { type: 'disabled' }, system: WEEKLY_SYSTEM });
    /* 키는 요청 머리에만 — 보낸 표와 남긴 행에는 없다 */
    expect(JSON.stringify(body.messages)).not.toContain('sk-test');
    expect(JSON.stringify(row.input)).not.toContain('sk-test');
    expect((row.input as WeeklyInput).domains.memory).toMatchObject({ minutes: 1, sessions: 1 });
  });

  it('쓸 수 없는 답이면 오류 — 쓴 토큰은 aiError 행으로 남는다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    stubFetch(okReply({ say: '지난주보다 99분 늘었구먼.', focus: [] }));
    await expect(weeklyReview()).rejects.toThrow('쓸 수 없어');
    const rows = await db.coachLogs.where('kind').equals('weekly').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 500, outputTokens: 90 });
    expect(rows[0].aiError).toContain('쓸 수 없어');
    expect(await latestWeekly()).toBeUndefined();
    expect((await usageThisMonth()).calls).toBe(1);
  });

  it('API 오류도 행으로 남겨 사용량에 센다', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, aiKey: 'sk-test' });
    stubFetch(() => new Response('{}', { status: 401 }));
    await expect(weeklyReview()).rejects.toThrow('키가 거부되었습니다');
    const rows = await db.coachLogs.where('kind').equals('weekly').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].aiError).toContain('키가 거부되었습니다');
    expect((await usageThisMonth()).calls).toBe(1);
  });
});
