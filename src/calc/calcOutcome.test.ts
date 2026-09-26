import { describe, expect, it } from 'vitest';
import type { CalcSession } from '../db/db';
import type { SessionSummary } from '../db/sessions';
import { CALC_EVENTS } from '../data/events';
import { defaultRules } from '../lib/rules';
import { passedOf } from '../lib/outcome';
import { calcContestOutcome, calcContestSessions, calcPracticeOutcome, clockKo, contestTimeMs, sameRules } from './calcOutcome';
import { calcLevels, evalCalcLevel } from './ladders';

const SQRT = CALC_EVENTS.find((e) => e.id === 'sqrt')!;
const RULES = defaultRules(SQRT.rules);

let k = 0;
const contest = (score: number, ms: number, o: Partial<CalcSession> = {}): CalcSession => ({
  id: `c${k++}`, disciplineId: 'sqrt', mode: 'contest', rules: { ...RULES }, params: { level: 4 }, seed: 'x',
  startedAt: 1000, endedAt: 1000 + ms, correct: score, wrong: 0, score, ...o,
});
const run = (score: number, totalMs: number, o: Partial<{ items: number; correct: number; wrong: number; limitSec: number }> = {}) => ({
  items: 10, correct: score, wrong: 10 - score, score, totalMs, limitSec: 0, ...o,
});

describe('모의 대회 비교 조건', () => {
  it('같은 규정(문항 수·제한시간·감점·자릿수·유효숫자·끝자리)으로 끝까지 치른 판만, 최근 것이 앞', () => {
    const ok1 = contest(5, 60_000, { startedAt: 1 });
    const ok2 = contest(6, 60_000, { startedAt: 2 });
    const log = {
      sessions: [
        ok1, ok2,
        contest(9, 1, { endedAt: undefined }), // 취소한 판
        contest(9, 1, { rules: { ...RULES, sigDigits: 6 } }),
        contest(9, 1, { rules: { ...RULES, rounding: 'round' } }),
        contest(9, 1, { rules: { ...RULES, items: 5 } }),
        contest(9, 1, { rules: { ...RULES, timeLimitSec: 600 } }),
        contest(9, 1, { mode: 'practice' }),
        contest(9, 1, { disciplineId: 'calendar' }),
      ],
      items: [],
    };
    expect(calcContestSessions(log, SQRT, RULES).map((s) => s.id)).toEqual([ok2.id, ok1.id]);
  });

  it('나중에 생긴 규정 칸은 기본값으로 본다', () => {
    const { rounding: _, ...old } = RULES;
    expect(sameRules(SQRT, old, RULES)).toBe(true);
    expect(sameRules(SQRT, old, { ...RULES, rounding: 'round' })).toBe(false);
  });

  it('걸린 시간 = endedAt − startedAt, 한국어 시계', () => {
    expect(contestTimeMs({ startedAt: 1000, endedAt: 253_000 })).toBe(252_000);
    expect(contestTimeMs({ startedAt: 1000 })).toBe(0);
    expect([clockKo(252_000), clockKo(52_000), clockKo(120_000), clockKo(0)]).toEqual(['4분 12초', '52초', '2분', '0초']);
  });
});

describe('모의 대회 결과', () => {
  it('첫 기록은 신기록이 아니다', () => {
    const o = calcContestOutcome({ eventId: 'sqrt', run: run(8, 252_000), past: [] });
    expect(o.record).toBeNull();
    expect(o.near).toEqual([]);
    expect(o.goals).toEqual([]);
  });

  it('점수가 높으면 신기록, 점수가 같으면 걸린 시간이 짧은 쪽', () => {
    const up = calcContestOutcome({ eventId: 'sqrt', run: run(8, 300_000), past: [contest(7, 200_000)] });
    expect(up.record).toEqual({ what: '점수 8점' });
    expect(up.sage).toBe('8점을 5분에 냈네. 지금까지 가장 좋은 기록이니 칠판 맨 위에 적어 두겠네.');
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(8, 250_000), past: [contest(8, 260_000)] }).record).toEqual({ what: '8점 · 4분 10초' });
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(8, 260_000), past: [contest(8, 260_000)] }).record).toBeNull();
    /* 0점 판은 겨루지 않는다 */
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(1, 10_000), past: [contest(0, 50_000)] }).record).toBeNull();
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(0, 10_000), past: [contest(3, 50_000)] }).record).toBeNull();
  });

  it('아까움: 점수 1점 이내, 또는 같은 점수에서 3초 이내로 늦음', () => {
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(7, 200_000), past: [contest(8, 260_000)] }).near)
      .toEqual([{ lead: '신기록까지', value: '1점' }]);
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(6, 200_000), past: [contest(8, 260_000)] }).near).toEqual([]);
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(8, 262_500), past: [contest(8, 260_000)] }).near)
      .toEqual([{ lead: '신기록까지', value: '2.5초' }]);
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(8, 263_001), past: [contest(8, 260_000)] }).near).toEqual([]);
  });

  it('제한시간이 있으면 시간이 다 되어 끝난 판끼리는 시계 오차로 신기록·아까움을 주지 않는다', () => {
    const lim = { limitSec: 60 };
    for (const [now, before] of [[60_040, 60_200], [60_200, 60_040]]) {
      const o = calcContestOutcome({ eventId: 'sqrt', run: run(5, now, lim), past: [contest(5, before)] });
      expect(o.record).toBeNull();
      expect(o.near).toEqual([]);
    }
    /* 제한시간 안에 끝낸 판은 여전히 시간으로 겨룬다 */
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(5, 55_000, lim), past: [contest(5, 60_200)] }).record)
      .toEqual({ what: '5점 · 55초' });
  });

  it('성적표 숫자와 스승님 한마디는 이 판의 실제 값', () => {
    const o = calcContestOutcome({ eventId: 'sqrt', run: run(8, 252_000), past: [contest(5, 100_000), contest(10, 100_000)] });
    expect(o.stats).toEqual([
      { label: '점수', value: '8', unit: '점', up: '▲3' },
      { label: '정답 수', value: '8' },
      { label: '오답 수', value: '2' },
      { label: '걸린 시간', value: '4:12' },
    ]);
    expect(o.sage).toBe('10문제 중 8문제, 4분 12초일세. 틀린 2문제의 정밀화 단계를 다시 보게.');
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(10, 300_000, { wrong: 0 }), past: [] }).sage)
      .toBe('10문제를 모두 맞혔네, 5분일세. 내일 다시 보세.');
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(4, 600_000, { wrong: 1, limitSec: 600 }), past: [] }).sage)
      .toBe('10문제 중 5문제를 10분에 풀었네. 시간 안에 끝까지 가는 것부터 다져 보세.');
    expect(calcContestOutcome({ eventId: 'sqrt', run: run(0, 600_000, { wrong: 0, limitSec: 600 }), past: [] }).sage)
      .toBe('한 문제도 풀지 못했군. 첫 문제부터 차근차근 손을 대 보세.');
    for (const s of [o.sage!]) expect(s).toMatch(/(세|네|게|군)\.$/);
  });
});

describe('연습 결과', () => {
  const L1 = calcLevels('sqrt')[0];
  const past = (perItemMs: number, items = 20, correct = 20): SessionSummary => ({
    id: String(perItemMs), kind: 'calc', domain: 'calc', disciplineId: 'sqrt', title: '제곱근', mode: 'practice',
    startedAt: 0, durationMs: 0, items, correct, accuracy: correct / items, perItemMs,
  });
  const drill = (meanRtMs: number, correct = 20, items = 20) => ({ items, correct, meanRtMs, maxStreak: correct, totalMs: 400_000 });

  it('목표 막대는 그 칸의 사다리 기준 셋, 신기록·아까움은 기초 드릴과 같은 규칙', () => {
    const status = evalCalcLevel(L1, Array.from({ length: 20 }, () => ({ isCorrect: true, rtMs: 20_000 })));
    const o = calcPracticeOutcome({ run: drill(20_000), status, past: [past(21_000)] });
    expect(o.goals.map((g) => g.label)).toEqual(['문항 20', '정확 90%', '반응 30초']);
    expect(passedOf(o)).toBe(true);
    expect(o.record).toEqual({ what: '평균 반응시간 20.00초' });
    expect(calcPracticeOutcome({ run: drill(20_000), status, past: [] }).record).toBeNull();
    /* 정확도 목표 90% — 20문항 중 17개면 1문제 모자람 */
    expect(calcPracticeOutcome({ run: drill(20_000, 17), status, past: [] }).near).toContainEqual({ lead: '정확도 목표까지', value: '1문제' });
  });
});
