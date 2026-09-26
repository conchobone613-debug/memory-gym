import { describe, expect, it } from 'vitest';
import type { GoalStatus } from '../db/goals';
import type { SessionSummary } from '../db/sessions';
import type { CalcItem, CalcSession, CoachLog } from '../db/db';
import { buildSummary, type CoachSummary, type SummaryInput } from './summary';
import { collapsed, ruleCourse } from './rule';
import { numbersIn, SAFE_SAY, validateCourse, validateReview } from './validate';
import { courseHref, courseStep, estimate, estimateMs, MAX_ITEMS, MIN_ITEMS, playedMatches, PREP_MS } from './catalog';
import { AUTO_CALL_CAP, shouldAutoAsk, sumUsage } from './store';
import { COURSE_SYSTEM, courseSchema, REVIEW_SYSTEM } from './prompts';
import type { CourseItem } from './types';

const T = new Date(2026, 8, 25, 12, 0, 0).getTime(); // 2026-09-25(금) 정오, 현지 시각
const DAY = 86_400_000;

const goal = (stage: 1 | 2 | 3, o: Partial<GoalStatus> = {}): GoalStatus => {
  const total = stage === 1 ? 10 : 100;
  return {
    stage, attempts: 0, accuracy: 0, medianRt: 0, unseen: total, checks: [], passed: false, next: '',
    rule: { reps: 3, accuracy: 0.95, rtMs: stage === 1 ? 1500 : 3000 }, enough: 0, total, ...o,
  };
};
const passedGoal = (stage: 1 | 2 | 3) =>
  goal(stage, { attempts: 400, accuracy: 0.98, medianRt: 900, unseen: 0, enough: stage === 1 ? 10 : 100, passed: true });

const input = (o: Partial<SummaryInput> = {}): SummaryInput => ({
  now: T, dailyMinutes: 15, summaries: [], goals: [goal(1), goal(2), goal(3)],
  calLog: { sessions: [], items: [] }, contestSec: 60, slowImages: [], ...o,
});

let n = 0;
const sess = (o: Partial<SessionSummary>): SessionSummary => ({
  id: `s${n++}`, kind: 'mapping', domain: 'memory', disciplineId: 'basics-1', title: '기초 1단계', mode: 'practice',
  startedAt: T, durationMs: 60_000, items: 30, correct: 30, accuracy: 1, perItemMs: 1000, ...o,
});

/** 달력 연습 한 판 — n 문항 중 앞 ok 개가 정답 */
function calRun(level: number, startedAt: number, count: number, ok: number, rtMs: number, mode: 'practice' | 'contest' = 'practice') {
  const id = `c${n++}`;
  const s: CalcSession = {
    id, disciplineId: 'calendar', mode, rules: {}, params: { level, steps: 0 }, seed: 'x', startedAt,
    endedAt: startedAt + count * rtMs, correct: ok, wrong: count - ok, score: ok,
  };
  const items: CalcItem[] = Array.from({ length: count }, (_, i) => ({
    id: `${id}-${i}`, sessionId: id, index: i, kind: 'year', prompt: '1999', expected: '1', answered: i < ok ? '1' : '2',
    isCorrect: i < ok, rtMs, shownAt: startedAt + i * rtMs,
  }));
  return { s, items };
}

const allNumbersFrom = (s: CoachSummary) => new Set(numbersIn(JSON.stringify(s)));
const memMs = (items: CourseItem[], s: CoachSummary) =>
  items.filter((i) => i.kind !== 'calendar').reduce((a, i) => a + estimateMs(i, s), 0);
const totalMs = (items: CourseItem[], s: CoachSummary) => items.reduce((a, i) => a + estimateMs(i, s), 0);

describe('훈련 요약표', () => {
  it('기록이 없으면 빈 칸과 첫 칸으로', () => {
    const s = buildSummary(input());
    expect(s.today).toEqual({ date: '2026-09-25', weekday: '금' });
    expect(s.daily).toEqual({ goalMin: 15, doneMin: 0, streak: 0 });
    expect(s.lastPracticeDay).toBeNull();
    expect(s.basics.current).toBe(1);
    expect(s.basics.stages[0]).toMatchObject({ stage: 1, name: '자음 하나', cells: 10, cellsDone: 0, accuracyPct: null, needAccuracyPct: 95, needSec: 1.5, paceSec: null, last2AccuracyPct: [] });
    expect(s.calendar.current).toBe(1);
    expect(s.calendar.levels).toHaveLength(4);
    expect(s.calendar.contest).toEqual({ level: 5, name: '1분 모의 대회', runs: 0, bestScore: null, limitSec: 60 });
    expect(s.events.map((e) => e.id)).toEqual(['speed-numbers', 'hour-numbers', 'speed-cards', 'spoken-numbers', 'binary']); // 열린 종목만
    expect(s.events.every((e) => e.runs === 0 && e.daysAgo === null)).toBe(true);
    expect(s.recent7).toEqual([]);
    expect(s.weak).toEqual({ images: [], calendarSteps: [] });
  });

  it('기록이 있으면 사람이 읽는 단위(%, 초, 분)로 옮긴다', () => {
    const lv1 = calRun(1, T - 2 * DAY, 30, 29, 2500);
    const lv2 = calRun(2, T - DAY, 12, 10, 1200);
    lv2.items[0].steps = [{ name: '연도 코드', ms: 3000, ok: true }, { name: '월 코드', ms: 1000, ok: true }];
    const s = buildSummary(input({
      summaries: [
        sess({ startedAt: T, accuracy: 0.8, correct: 24, durationMs: 90_000 }),
        sess({ startedAt: T - 3600_000, accuracy: 0.7, correct: 21, durationMs: 60_000 }),
        sess({ startedAt: T - 3 * DAY, kind: 'recall', disciplineId: 'speed-cards', title: '스피드 카드', items: 13, correct: 12, accuracy: 12 / 13, durationMs: 300_000 }),
      ],
      goals: [goal(1, { attempts: 60, accuracy: 0.9, medianRt: 1820, enough: 10, unseen: 0 }), goal(2), goal(3, { total: 0, unseen: 0 })],
      calLog: { sessions: [lv1.s, lv2.s], items: [...lv1.items, ...lv2.items] },
      slowImages: [{ key: '47', name: '로켓', medianRt: 4210, attempts: 9, errRate: 1 / 3 }],
    }));

    expect(s.daily).toEqual({ goalMin: 15, doneMin: 3, streak: 1 });
    expect(s.lastPracticeDay).toBe('2026-09-25');
    expect(s.basics.stages[0]).toMatchObject({ accuracyPct: 90, medianSec: 1.82, cellsDone: 10, last2AccuracyPct: [80, 70], paceSec: 2.5 });
    expect(s.basics.stages[2].cells).toBe(0);
    expect(s.calendar.levels[0]).toMatchObject({ passed: true, recentItems: 30, accuracyPct: 97, medianSec: 2.5, needSec: 3 });
    expect(s.calendar.current).toBe(2);
    expect(s.calendar.levels[1]).toMatchObject({ passed: false, recentItems: 12, accuracyPct: 83, last2AccuracyPct: [83] });
    expect(s.events.find((e) => e.id === 'speed-cards')).toMatchObject({ runs: 1, daysAgo: 3, lastRun: 'easy', lastAccuracyPct: 92, easyMin: 5, realMin: null, lastDay: '2026-09-22' });
    expect(s.recent7.find((r) => r.id === 'basics-1')).toMatchObject({ sessions: 2, items: 60, accuracyPct: 75, secPerItem: 1 });
    expect(s.weak.images).toEqual([{ key: '47', name: '로켓', medianSec: 4.21, wrongPct: 33 }]);
    expect(s.weak.calendarSteps).toEqual([{ name: '연도 코드', avgSec: 3, n: 1 }, { name: '월 코드', avgSec: 1, n: 1 }]);
  });

  it('사람 신원 정보가 들어갈 칸이 없다', () => {
    const keys = Object.keys(buildSummary(input()));
    expect(keys).toEqual(['today', 'daily', 'lastPracticeDay', 'basics', 'calendar', 'events', 'recent7', 'recent30', 'weak']);
  });
});

describe('규칙 코치', () => {
  const empty = buildSummary(input());

  it('기억력이 시간의 약 2/3 — 기억력 항목이 앞, 달력이 뒤', () => {
    const c = ruleCourse(empty, 15);
    expect(c.items.map((i) => i.kind)).toEqual(['basics', 'event', 'event', 'calendar']);
    const mem = memMs(c.items, empty);
    expect(mem / totalMs(c.items, empty)).toBeGreaterThan(0.6);
  });

  it('사다리 지금 칸에서 — 기초·달력 모두 current', () => {
    const c = ruleCourse(empty, 15);
    expect(c.items[0]).toMatchObject({ kind: 'basics', stage: 1 });
    expect(c.items.at(-1)).toMatchObject({ kind: 'calendar', level: 1 });
  });

  it.each([5, 10, 15, 30, 60])('분량을 %i분에 맞춘다(문항 10~60)', (m) => {
    const c = ruleCourse(empty, m);
    expect(totalMs(c.items, empty)).toBeLessThanOrEqual(m * 60_000);
    for (const i of c.items) if (i.kind !== 'event' && !(i.kind === 'calendar' && i.level === 5)) {
      expect(i.items).toBeGreaterThanOrEqual(MIN_ITEMS);
      expect(i.items).toBeLessThanOrEqual(MAX_ITEMS);
    }
    for (const i of c.items) expect(i.estMinutes).toBe(estimate(i, empty));
  });

  it('최근 두 판이 기준보다 10%p 이상 낮으면 한 칸 아래를 권한다', () => {
    expect(collapsed([84, 85], 95)).toBe(true);
    expect(collapsed([84, 86], 95)).toBe(false);
    expect(collapsed([70], 95)).toBe(false);

    const s = buildSummary(input({
      summaries: [
        sess({ disciplineId: 'basics-2', title: '기초 2단계', accuracy: 0.8, correct: 24 }),
        sess({ disciplineId: 'basics-2', title: '기초 2단계', accuracy: 0.82, startedAt: T - 1000 }),
      ],
      goals: [passedGoal(1), goal(2, { attempts: 60, accuracy: 0.81, medianRt: 2500, enough: 20, unseen: 40 }), goal(3)],
    }));
    const c = ruleCourse(s, 15);
    expect(c.items[0]).toMatchObject({ kind: 'basics', stage: 1 });
    expect(c.say).toContain('80%');
    expect(c.say).toContain('82%');
    expect(c.items[0].why).toContain('한 칸 아래');
  });

  it('달력도 무너지면 한 칸 아래', () => {
    const a = calRun(1, T - 3 * DAY, 30, 30, 2000);
    const b = calRun(2, T - 2 * DAY, 30, 30, 1000);
    const c3 = calRun(3, T - DAY, 20, 14, 7000);
    const d3 = calRun(3, T - 1000, 20, 15, 7000);
    const s = buildSummary(input({ calLog: { sessions: [a.s, b.s, c3.s, d3.s], items: [...a.items, ...b.items, ...c3.items, ...d3.items] } }));
    expect(s.calendar.current).toBe(3);
    expect(ruleCourse(s, 15).items.at(-1)).toMatchObject({ kind: 'calendar', level: 2 });
  });

  it('못 채운 조건을 겨냥한다 — 정확도, 안 본 칸', () => {
    const acc = buildSummary(input({ goals: [goal(1, { attempts: 60, accuracy: 0.9, medianRt: 1200, enough: 10, unseen: 0 }), goal(2), goal(3)] }));
    const c = ruleCourse(acc, 15);
    expect(c.items[0].why).toBe('정확도 90%를 95%까지 올려야 합니다.');
    expect(c.say).toBe('기초 1단계 정확도가 지금 90%일세. 기준 95%까지 끌어올려 보세.');

    const unseen = buildSummary(input({ goals: [passedGoal(1), passedGoal(2), goal(3, { attempts: 50, accuracy: 0.9, medianRt: 2000, enough: 10, unseen: 60 })] }));
    const u = ruleCourse(unseen, 15);
    expect(u.items[0]).toMatchObject({ kind: 'basics', stage: 3, pick: 'unseen' });
    expect(u.items[0].why).toBe('아직 안 본 칸이 60칸 남았습니다.');
  });

  it('오래 안 한 종목을 챙기고, 연습이 좋으면 모의 대회로', () => {
    const s = buildSummary(input({
      summaries: [
        sess({ kind: 'recall', disciplineId: 'speed-numbers', title: '스피드 숫자', startedAt: T - DAY, accuracy: 0.95, durationMs: 240_000 }),
        sess({ kind: 'recall', disciplineId: 'speed-cards', title: '스피드 카드', startedAt: T - 6 * DAY, accuracy: 0.95, durationMs: 150_000 }),
        /* 한 번도 안 한 종목이 앞서므로 듣기·이진수는 오늘 해 둔다 — 여기서는 오래 쉰 순서만 본다 */
        sess({ kind: 'recall', disciplineId: 'spoken-numbers', title: '듣고 외우는 숫자', startedAt: T, accuracy: 0.5 }),
        sess({ kind: 'recall', disciplineId: 'binary', title: '이진수', startedAt: T, accuracy: 0.5 }),
      ],
    }));
    /* 1시간 숫자는 한 번도 안 했지만 연습만 45분이라 30분 코스에 들지 않는다 */
    const events = ruleCourse(s, 30).items.filter((i) => i.kind === 'event');
    expect(events).toEqual([
      expect.objectContaining({ eventId: 'speed-cards', run: 'real', why: '마지막으로 한 지 6일 된 종목입니다.' }),
      /* 모의 대회(20분)는 남은 시간에 안 들어 연습으로 */
      expect.objectContaining({ eventId: 'speed-numbers', run: 'easy', why: '지난 판 정확도 95%에서 이어 갑니다.' }),
    ]);
  });

  it('스승님 말과 이유에는 요약표에 있는 숫자만 — 하게체 · 평문', () => {
    const cases = [
      buildSummary(input()),
      buildSummary(input({ goals: [goal(1, { attempts: 60, accuracy: 0.97, medianRt: 1820, enough: 10, unseen: 0 }), goal(2), goal(3)] })),
      buildSummary(input({ goals: [goal(1, { attempts: 20, accuracy: 0.97, medianRt: 1200, enough: 4, unseen: 2 }), goal(2), goal(3)] })),
      buildSummary(input({ goals: [passedGoal(1), passedGoal(2), passedGoal(3)] })),
    ];
    for (const s of cases) {
      const c = ruleCourse(s, 15);
      const ok = allNumbersFrom(s);
      for (const x of numbersIn(c.say)) expect(ok.has(x), `say 의 ${x}`).toBe(true);
      for (const i of c.items) for (const x of numbersIn(i.why)) expect(ok.has(x), `why 의 ${x}`).toBe(true);
      expect(c.say).toMatch(/(세|네|게)\.$/);
      for (const i of c.items) expect(i.why).toMatch(/니다\.$/);
    }
  });
});

describe('스승님 코스 검사', () => {
  const s = buildSummary(input({ goals: [goal(1), goal(2), goal(3, { total: 50, unseen: 50 })] }));
  const ai = (o: Record<string, unknown>) => ({
    kind: 'basics', stage: 0, level: 0, eventId: 'none', run: 'none', pick: 'none', items: 0, steps: false, why: '', ...o,
  });

  it('등록부에 없는 종목·잠긴 종목·모르는 종류는 버린다', () => {
    const c = validateCourse({
      say: '해 보세.',
      items: [
        ai({ kind: 'event', eventId: 'words', run: 'easy' }),
        ai({ kind: 'event', eventId: 'foo', run: 'easy' }),
        ai({ kind: 'sqrt', level: 1, items: 10 }),
        ai({ kind: 'event', eventId: 'speed-cards', run: 'real' }),
      ],
    }, s, 30);
    /* 스승님이 고른 것 가운데 쓸 수 있는 것만 앞에 남고, 뒤는 분량을 채운 규칙 항목이다 */
    expect(c?.items[0]).toMatchObject({ kind: 'event', eventId: 'speed-cards' });
    expect(c?.items.some((i) => i.kind === 'event' && ['words', 'foo'].includes(i.eventId))).toBe(false);
    expect(c?.items[0]).toMatchObject({ run: 'real' });
  });

  it('범위 밖 값은 자르거나 버린다', () => {
    const c = validateCourse({
      say: '',
      items: [
        ai({ stage: 7, items: 20 }),
        ai({ kind: 'calendar', level: 0, items: 20 }),
        ai({ stage: 1, items: 500 }),
        ai({ kind: 'calendar', level: 2, items: 3, steps: true }),
        ai({ kind: 'calendar', level: 5, items: 40 }),
      ],
    }, s, 60)!;
    /* 5칸은 지금 칸(1)+1 로 내려 2칸이 되고, 이미 있는 2칸과 겹쳐 빠진다 */
    expect(c.items.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'basics', stage: 1, items: 60 }),
      expect.objectContaining({ kind: 'calendar', level: 2 }),
    ]);
    expect((c.items[1] as { items: number }).items).toBeGreaterThanOrEqual(10); // 3 → 10, 분량을 채우며 더 늘 수 있다
    expect(c.items[1]).not.toHaveProperty('steps'); // 단계 입력은 3·4칸만
    expect(c.say).toBe(SAFE_SAY);
  });

  it('사다리는 지금 칸에서 한 칸 위까지만 — 모의 대회 칸도 지금 칸+1 을 넘으면 내린다', () => {
    const c = validateCourse({ say: '', items: [ai({ stage: 3, items: 20, pick: 'weak' }), ai({ kind: 'calendar', level: 5 })] }, s, 60)!;
    expect(c.items[0]).toMatchObject({ kind: 'basics', stage: 2 });
    expect(c.items[0]).not.toHaveProperty('pick');
    expect(c.items[1]).toMatchObject({ kind: 'calendar', level: 2 });
    expect((c.items[1] as { items: number }).items).toBeGreaterThanOrEqual(20);

    const top = buildSummary(input({ goals: [passedGoal(1), passedGoal(2), passedGoal(3)] }));
    top.calendar.current = 5;
    expect(validateCourse({ say: '', items: [ai({ kind: 'calendar', level: 5, items: 40 })] }, top, 15)!.items[0])
      .toMatchObject({ kind: 'calendar', level: 5, items: 0 });
  });

  it('이미지 이름이 없으면 3단계는 낼 수 없다', () => {
    const none = buildSummary(input({ goals: [passedGoal(1), passedGoal(2), goal(3, { total: 0, unseen: 0 })] }));
    expect(validateCourse({ say: '', items: [ai({ stage: 3, items: 20 })] }, none, 15)).toBeNull();
  });

  it('남은 항목이 없으면 null(→ 규칙 코치)', () => {
    expect(validateCourse({ say: '해 보세.', items: [] }, s, 15)).toBeNull();
    expect(validateCourse('아무 글', s, 15)).toBeNull();
    expect(validateCourse({ say: '해 보세.' }, s, 15)).toBeNull();
    expect(validateCourse({ items: [ai({ kind: 'event', eventId: 'words', run: 'easy' })] }, s, 15)).toBeNull();
  });

  it('항목은 다섯까지, 같은 항목은 한 번만', () => {
    const all = buildSummary(input({ goals: [passedGoal(1), passedGoal(2), passedGoal(3)] }));
    all.calendar.current = 5;
    const items = [1, 2, 3].map((st) => ai({ stage: st, items: 10 }))
      .concat([1, 1, 2, 3, 4].map((lv) => ai({ kind: 'calendar', level: lv, items: 10 })));
    const c = validateCourse({ say: '', items }, all, 120)!;
    expect(c.items).toHaveLength(5);
    expect(c.items.map((i) => (i.kind === 'basics' ? `b${i.stage}` : i.kind === 'calendar' ? `c${i.level}` : ''))).toEqual(['b1', 'b2', 'b3', 'c1', 'c2']);
  });

  it('예상 분은 코드가 다시 계산하고 분량을 넘으면 줄인다', () => {
    const c = validateCourse({ say: '', items: [ai({ stage: 1, items: 60, estMinutes: 1 }), ai({ kind: 'calendar', level: 1, items: 60 })] }, s, 3)!;
    for (const i of c.items) expect(i.estMinutes).toBe(estimate(i, s));
    expect(totalMs(c.items, s)).toBeLessThanOrEqual(3 * 60_000);
  });

  it('요약에 없는 숫자가 섞인 문장·이유는 뺀다', () => {
    const c = validateCourse({
      say: '기초 1단계부터 해 보세. 95%까지 37%p 남았으니 힘내시게.',
      items: [ai({ stage: 1, items: 20, why: '정확도를 77%까지 올립니다.' }), ai({ stage: 2, items: 20, why: '두 자리를 익힙니다.' })],
    }, s, 30)!;
    expect(c.say).toBe('기초 1단계부터 해 보세.');
    expect(c.items[0].why).toBe('기초 1단계(자음 하나)를 연습합니다.');
    expect(c.items[1].why).toBe('두 자리를 익힙니다.');
  });

  it('숫자는 단위까지 맞춘다 — %p 는 늘 버리고, % 는 요약의 정확도 값만', () => {
    /* 4 는 카탈로그('4칸')에 있어도, 95%까지 남은 '4%p' 는 스승님이 직접 뺀 값이다 */
    const c = validateCourse({
      say: '95%까지 4%p 남았으니 힘내시게! 기준은 95%일세. 오늘은 4% 더 올려 보세.',
      items: [ai({ stage: 1, items: 20, why: '4칸을 채워 정확도 4%를 올립니다.' })],
    }, s, 15)!;
    expect(c.say).toBe('기준은 95%일세.');
    expect(c.items[0].why).toBe('기초 1단계(자음 하나)를 연습합니다.');
  });

  it('말투를 다시 본다 — why 는 평문, say 는 하게체', () => {
    const c = validateCourse({
      say: '오늘도 열심히 해 봅시다. 기초 1단계부터 해 보세. 잘하셨어요.',
      items: [ai({ stage: 1, items: 20, why: '약한 칸을 복습하게.' }), ai({ stage: 2, items: 20, why: '두 자리를 익힙니다' })],
    }, s, 30)!;
    expect(c.say).toBe('기초 1단계부터 해 보세.');
    expect(c.items[0].why).toBe('기초 1단계(자음 하나)를 연습합니다.');
    expect(c.items[1].why).toBe('두 자리를 익힙니다');
    expect(validateCourse({ say: '해 봅시다.', items: [ai({ stage: 1, items: 20 })] }, s, 15)!.say).toBe(SAFE_SAY);
  });

  it('고치거나 버린 항목을 말하는 문장·이유는 뺀다', () => {
    /* 지금 칸이 1 이라 3단계는 2단계로 내린다 — '3단계' 를 권하는 말은 코스와 어긋난다 */
    const c = validateCourse({
      say: '기초 3단계 약한 칸을 복습해 보세. 차근차근 해 보게.',
      items: [ai({ stage: 3, items: 20, pick: 'weak', why: '3단계 약한 칸을 복습합니다.' })],
    }, s, 30)!;
    expect(c.items[0]).toMatchObject({ kind: 'basics', stage: 2 });
    expect(c.say).toBe('차근차근 해 보게.');
    expect(c.items[0].why).toBe('기초 2단계(두 자리)를 연습합니다.');
    /* 그대로 남은 항목을 말하는 문장은 둔다 */
    expect(validateCourse({ say: '기초 1단계부터 해 보세.', items: [ai({ stage: 1, items: 20 })] }, s, 15)!.say).toBe('기초 1단계부터 해 보세.');
  });

  it('분량은 코드가 채운다 — 스승님이 적게 잡아도 가진 시간의 80% 이상, 스승님이 고른 항목이 앞에 그대로', () => {
    /* 실측(2026-09-26): 15분을 청했는데 스승님 코스가 약 5분이었다 */
    const c = validateCourse({ say: '', items: [ai({ stage: 1, items: 10 })] }, s, 15)!;
    expect(c.items[0]).toMatchObject({ kind: 'basics', stage: 1 });
    expect(totalMs(c.items, s)).toBeGreaterThanOrEqual(0.8 * 15 * 60_000);
    expect(totalMs(c.items, s)).toBeLessThanOrEqual(15 * 60_000);
    expect(c.items.length).toBeLessThanOrEqual(5);
  });

  it('가진 시간보다 긴 기억력 종목은 연습으로 내리고, 그래도 길면 버린다', () => {
    const items = [ai({ kind: 'event', eventId: 'hour-numbers', run: 'real' }), ai({ stage: 1, items: 20 })];
    const short = validateCourse({ say: '1시간 숫자를 해 보세.', items }, s, 15)!;
    expect(short.items[0].kind).toBe('basics');
    expect(short.items.some((i) => i.kind === 'event' && i.eventId === 'hour-numbers')).toBe(false);
    expect(short.say).toBe(SAFE_SAY);
    const hour = validateCourse({ say: '', items }, s, 60)!;
    expect(hour.items[0]).toMatchObject({ kind: 'event', eventId: 'hour-numbers', run: 'easy' });
    expect(totalMs(hour.items, s)).toBeLessThanOrEqual(60 * 60_000);
  });
});

describe('스승님 복기 검사', () => {
  const inp = {
    title: '기초 1단계', mode: 'practice' as const, items: 30, correct: 27, accuracyPct: 90, secPerItem: 1.2, minutes: 0.9,
    slowest: [{ prompt: '47', answer: 'ㄹㅅ', sec: 2.8 }], wrong: [], previous: { day: '2026-09-24', accuracyPct: 88, secPerItem: 1.4 },
  };
  it('숫자·말투를 검사한다 — next 는 평문, say 는 하게체', () => {
    expect(validateReview({ say: '정확도 90%로 지난 판 88%보다 올랐네. 2%p 올랐구먼.', next: '47 칸을 먼저 봅니다.' }, inp))
      .toEqual({ say: '정확도 90%로 지난 판 88%보다 올랐네.', next: '47 칸을 먼저 봅니다.' });
    expect(validateReview({ say: "'47' 이 2.8초로 가장 느렸네.", next: '느린 칸을 연습하게.' }, inp)!.next).toBe('');
    expect(validateReview({ say: '잘하셨습니다.', next: '' }, inp)).toBeNull();
    expect(validateReview({ say: '24일 판보다 올랐네.', next: '' }, inp)!.say).toBe('24일 판보다 올랐네.');
    /* 초 값이 요약의 초가 아니면(2.8 은 있어도 '2.8%' 는 없다) 뺀다 */
    expect(validateReview({ say: '정확도가 2.8% 올랐네.', next: '' }, inp)).toBeNull();
  });
});

describe('코스 항목대로 한 판인가', () => {
  it('달력은 칸·단계 입력, 종목은 프리셋·모드, 기초는 단계', () => {
    expect(playedMatches({ kind: 'calendar', level: 3, items: 20, steps: true }, { kind: 'calendar', level: 3, steps: true })).toBe(true);
    expect(playedMatches({ kind: 'calendar', level: 3, items: 20, steps: true }, { kind: 'calendar', level: 3, steps: false })).toBe(false);
    expect(playedMatches({ kind: 'calendar', level: 3, items: 20 }, { kind: 'calendar', level: 1, steps: false })).toBe(false);
    expect(playedMatches({ kind: 'calendar', level: 5, items: 0 }, { kind: 'calendar', level: 5, steps: false })).toBe(true);
    expect(playedMatches({ kind: 'event', eventId: 'speed-cards', run: 'real' }, { kind: 'event', presetId: 'c52', run: 'real' })).toBe(true);
    expect(playedMatches({ kind: 'event', eventId: 'speed-cards', run: 'real' }, { kind: 'event', presetId: 'c20', run: 'real' })).toBe(false);
    expect(playedMatches({ kind: 'event', eventId: 'speed-cards', run: 'real' }, { kind: 'event', presetId: 'c52', run: 'easy' })).toBe(false);
    expect(playedMatches({ kind: 'event', eventId: 'speed-cards', run: 'real' }, { kind: 'event', presetId: null, run: 'real' })).toBe(false);
    expect(playedMatches({ kind: 'basics', stage: 2, items: 20 }, { kind: 'basics', stage: 2 })).toBe(true);
    expect(playedMatches({ kind: 'basics', stage: 2, items: 20 }, { kind: 'calendar', level: 2, steps: false })).toBe(false);
  });
});

describe('예상 시간', () => {
  const s = buildSummary(input());

  it('기록이 없으면 기본값 × 문항 + 준비 여유', () => {
    expect(estimateMs({ kind: 'basics', stage: 1, items: 20 }, s)).toBe(PREP_MS + 20 * 1500);
    expect(estimateMs({ kind: 'basics', stage: 3, items: 10 }, s)).toBe(PREP_MS + 10 * 4000);
    expect(estimateMs({ kind: 'calendar', level: 2, items: 30 }, s)).toBe(PREP_MS + 30 * 2000);
    expect(estimateMs({ kind: 'calendar', level: 3, items: 10 }, s)).toBe(PREP_MS + 10 * 12_000);
    expect(estimateMs({ kind: 'calendar', level: 5, items: 0 }, s)).toBe(PREP_MS + 60_000);
    expect(estimateMs({ kind: 'event', eventId: 'speed-numbers', run: 'real' }, s)).toBe(PREP_MS + 1200_000);
    expect(estimateMs({ kind: 'event', eventId: 'speed-numbers', run: 'easy' }, s)).toBe(PREP_MS + 300_000);
    expect(estimate({ kind: 'basics', stage: 1, items: 20 }, s)).toBe(1);
  });

  it('기록이 있으면 최근 한 문항에 든 시간 · 최근 판 걸린 시간', () => {
    const r = buildSummary(input({
      summaries: [
        sess({ durationMs: 60_000, items: 30 }),
        sess({ kind: 'recall', disciplineId: 'speed-cards', title: '스피드 카드', durationMs: 240_000, startedAt: T - DAY }),
      ],
    }));
    expect(estimateMs({ kind: 'basics', stage: 1, items: 30 }, r)).toBe(PREP_MS + 30 * 2000);
    expect(estimateMs({ kind: 'event', eventId: 'speed-cards', run: 'easy' }, r)).toBe(PREP_MS + 240_000);
    expect(estimate({ kind: 'event', eventId: 'speed-cards', run: 'easy' }, r)).toBe(5);
  });
});

describe('화면 주소', () => {
  it('항목 → 주소', () => {
    expect(courseHref({ kind: 'basics', stage: 3, items: 30, pick: 'weak' })).toBe('/basics?stage=3&n=30&pick=weak');
    expect(courseHref({ kind: 'basics', stage: 1, items: 20, pick: 'weak' })).toBe('/basics?stage=1&n=20');
    expect(courseHref({ kind: 'calendar', level: 3, items: 20, steps: true })).toBe('/calc/calendar/run?level=3&n=20&steps=1');
    expect(courseHref({ kind: 'calendar', level: 1, items: 40 })).toBe('/calc/calendar/run?level=1&n=40');
    expect(courseHref({ kind: 'calendar', level: 5, items: 0 })).toBe('/calc/calendar/run?mode=contest');
    expect(courseHref({ kind: 'event', eventId: 'speed-numbers', run: 'easy' })).toBe('/practice?preset=d80&event=speed-numbers&run=easy');
  });

  it('코스 진행 표시를 붙이고 다시 읽는다', () => {
    const href = courseHref({ kind: 'event', eventId: 'speed-cards', run: 'real' }, 'log-1', 2);
    expect(href).toBe('/practice?preset=c52&event=speed-cards&run=real&course=log-1&ci=2');
    expect(courseStep(new URLSearchParams(href.split('?')[1]))).toEqual({ logId: 'log-1', index: 2 });
    expect(courseStep(new URLSearchParams('stage=1'))).toBeNull();
    expect(courseStep(new URLSearchParams('course=x&ci=-1'))).toBeNull();
  });
});

describe('사용량과 자동 호출', () => {
  const log = (o: Partial<CoachLog>): CoachLog => ({ id: `l${n++}`, kind: 'course', at: T, input: {}, output: '', ...o });

  it('이번 달 스승님 호출만 더한다(규칙 코스는 빼고, 실패한 호출은 센다)', () => {
    const u = sumUsage([
      log({ source: 'ai', inputTokens: 1000, outputTokens: 200 }),
      log({ kind: 'review', source: 'ai', inputTokens: 500, outputTokens: 100 }),
      log({ source: 'rule', aiError: '키가 거부되었습니다.' }),
      log({ source: 'rule' }),
      log({ source: 'ai', inputTokens: 9999, outputTokens: 9999, at: new Date(2026, 7, 31, 23).getTime() }),
    ], T);
    expect(u).toEqual({ calls: 3, inputTokens: 1500, outputTokens: 300, usd: 0.009 });
  });

  it('하루 1회 — 키 있음 · 자동 켬 · 상한 전 · 오늘 아직 안 물었을 때만', () => {
    const key = { aiKey: 'sk-test' };
    expect(shouldAutoAsk({}, [], { calls: 0 })).toBe(false);
    expect(shouldAutoAsk({ aiKey: '  ' }, [], { calls: 0 })).toBe(false);
    expect(shouldAutoAsk(key, [], { calls: 0 })).toBe(true);
    expect(shouldAutoAsk({ ...key, coachAuto: false }, [], { calls: 0 })).toBe(false);
    expect(shouldAutoAsk(key, [], { calls: AUTO_CALL_CAP })).toBe(false);
    expect(shouldAutoAsk(key, [log({ source: 'ai' })], { calls: 1 })).toBe(false);
    expect(shouldAutoAsk(key, [log({ source: 'rule', aiError: '요청이 몰렸습니다.' })], { calls: 1 })).toBe(false);
    expect(shouldAutoAsk(key, [log({ source: 'rule' })], { calls: 0 })).toBe(true);
    expect(shouldAutoAsk(key, [log({ kind: 'review', source: 'ai' })], { calls: 1 })).toBe(true);
  });
});

describe('답 형식(JSON 스키마)', () => {
  it('모든 object 에 additionalProperties:false 와 전부 required, 범위 제약 없음', () => {
    const schema = courseSchema();
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) expect(o).not.toHaveProperty(k);
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(schema);
    const item = (schema.properties as { items: { items: { properties: { eventId: { enum: string[] } } } } }).items.items;
    expect(item.properties.eventId.enum).toEqual(['speed-numbers', 'hour-numbers', 'speed-cards', 'spoken-numbers', 'binary', 'none']);
  });

  it('스승님 글의 기본 시간·문항 범위는 코드 값을 옮겨 적는다 · 맞는 예와 틀린 예가 있다', () => {
    expect(COURSE_SYSTEM).toContain('기초 1.5·3·4초');
    expect(COURSE_SYSTEM).toContain('달력 1칸 4초·2칸 2초·3칸 12초·4칸 12초');
    expect(COURSE_SYSTEM).toContain('문항 수는 10~60');
    for (const sys of [COURSE_SYSTEM, REVIEW_SYSTEM]) {
      expect(sys).toContain('맞는 예');
      expect(sys).toContain('틀린 예');
    }
  });
});
