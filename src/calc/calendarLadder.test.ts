import { describe, expect, it } from 'vitest';
import type { CalcItem, CalcSession } from '../db/db';
import {
  CAL_LEVELS, contestSessions, currentLevel, evalLevel, ladderStatus, levelItems, practiceIds, yearsFor,
} from './calendarLadder';

const L = (n: number) => CAL_LEVELS[n - 1];
/** 최근 것부터 n문항: 앞의 correct 개는 맞힘, 반응시간은 모두 rtMs */
const items = (n: number, correct: number, rtMs: number) =>
  Array.from({ length: n }, (_, i) => ({ isCorrect: i < correct, rtMs }));

describe('달력 사다리 — 칸 정의', () => {
  it('다섯 칸, 마지막은 통과 기준 없는 모의 대회', () => {
    expect(CAL_LEVELS.map((l) => l.name)).toEqual(['연도 코드', '월·세기 코드', '한 세기', '전체 범위', '1분 모의 대회']);
    expect(CAL_LEVELS.map((l) => l.pass?.medianMs)).toEqual([3000, 1500, 8000, 6000, undefined]);
  });
  it('연도 범위: 칸이 정하지 않으면 규정 값', () => {
    const rules = { yearFrom: 1700, yearTo: 1650 };
    expect(yearsFor(L(1), rules)).toEqual([1600, 2099]);
    expect(yearsFor(L(3), rules)).toEqual([1900, 1999]);
    expect(yearsFor(L(4), rules)).toEqual([1650, 1700]);
  });
});

describe('칸 평가', () => {
  it('기록이 없으면 막대는 비어 있고 통과가 아니다', () => {
    const s = evalLevel(L(1), []);
    expect(s.passed).toBe(false);
    expect(s.bars.map((b) => [b.ratio, b.text, b.met])).toEqual([[0, '0/30', false], [0, '—', false], [0, '—', false]]);
  });

  it('경계: 30문항 · 29개(96.7%) · 중앙 3초 = 통과', () => {
    const s = evalLevel(L(1), items(30, 29, 3000));
    expect(s.passed).toBe(true);
    expect(s.bars.map((b) => b.label)).toEqual(['문항 30', '정확 95%', '반응 3초']);
    expect(s.bars.map((b) => b.text)).toEqual(['30/30', '97%', '3.00초']);
  });

  it('하나라도 모자라면 통과가 아니다: 29문항 / 28개(93%) / 3.001초', () => {
    expect(evalLevel(L(1), items(29, 29, 1000)).passed).toBe(false);
    const acc = evalLevel(L(1), items(30, 28, 1000));
    expect(acc.passed).toBe(false);
    expect(acc.bars[1].met).toBe(false);
    const rt = evalLevel(L(1), items(30, 30, 3001));
    expect(rt.passed).toBe(false);
    expect(rt.bars[2]).toMatchObject({ met: false, text: '3.00초' });
    expect(rt.bars[2].ratio).toBeCloseTo(3000 / 3001);
  });

  it('최근 30문항만 본다 — 그 전의 오답은 세지 않는다', () => {
    const recent = [...items(30, 30, 1200), ...items(20, 0, 9000)];
    expect(evalLevel(L(2), recent)).toMatchObject({ attempts: 30, accuracy: 1, medianRt: 1200, passed: true });
  });

  it('모름(0ms)은 중앙 반응시간 표본에서 뺀다', () => {
    const s = evalLevel(L(1), [{ isCorrect: false, rtMs: 0 }, { isCorrect: true, rtMs: 2000 }, { isCorrect: true, rtMs: 4000 }]);
    expect(s.medianRt).toBe(3000);
  });

  it('모의 대회 칸은 막대가 없고 통과하지 않는다', () => {
    expect(evalLevel(L(5), items(40, 40, 1000))).toMatchObject({ bars: [], passed: false });
  });
});

describe('지금 칸', () => {
  const st = (passed: number) => CAL_LEVELS.map((l) => ({ ...evalLevel(l, []), passed: l.n <= passed }));
  it('통과 못 한 첫 칸', () => {
    expect(currentLevel(st(0)).n).toBe(1);
    expect(currentLevel(st(2)).n).toBe(3);
    expect(currentLevel(st(4)).n).toBe(5);
  });
  it('사다리 표에 적힌 칸이 있으면 그 칸이 먼저', () => {
    expect(currentLevel(st(3), 'calendar-2').n).toBe(2);
    expect(currentLevel(st(3), 'basics-1').n).toBe(4); // 모르는 칸이면 기록으로
  });
});

describe('기록에서 칸 문항 고르기', () => {
  const session = (id: string, level: number, mode: CalcSession['mode'] = 'practice'): CalcSession => ({
    id, disciplineId: 'calendar', mode, rules: {}, params: { level }, seed: 's', startedAt: 0, correct: 0, wrong: 0, score: 0,
  });
  const item = (sessionId: string, index: number, shownAt: number, isCorrect = true): CalcItem => ({
    id: `${sessionId}${index}`, sessionId, index, kind: 'year', prompt: '', expected: '0', answered: '0', isCorrect, rtMs: 1000, shownAt,
  });

  it('그 칸의 연습 세션 문항만, 최근 것부터', () => {
    const log = {
      sessions: [session('a', 1), session('b', 2), session('c', 1), session('d', 1, 'contest')],
      items: [item('a', 0, 10), item('b', 0, 20), item('c', 0, 30), item('c', 1, 40), item('d', 0, 50)],
    };
    expect(levelItems(log, 1).map((i) => i.id)).toEqual(['c1', 'c0', 'a0']);
    const status = ladderStatus(log);
    expect(status.map((s) => s.attempts)).toEqual([3, 1, 0, 0, 0]);
  });

  it('신기록 비교용: 단계 입력 설정이 같은 판만(사다리는 칸 단위 그대로)', () => {
    const on = { ...session('s', 3), params: { level: 3, steps: 1 } };
    const log = { sessions: [session('a', 3), on, { ...session('o', 3), params: { level: 3, steps: 0 } }], items: [] };
    expect([...practiceIds(log, 3, true)]).toEqual(['s']);
    expect([...practiceIds(log, 3, false)]).toEqual(['a', 'o']);
    expect(practiceIds(log, 3).size).toBe(3);
  });

  it('모의 대회: 제한시간·오답 감점·연도 범위가 같고 끝까지 치른 판만', () => {
    const k = { limitSec: 60, penalty: 1, yearFrom: 1600, yearTo: 2099 };
    const c = (id: string, limitSec: number, penalty: number, yearFrom = 1600, ended = true): CalcSession => ({
      ...session(id, 5, 'contest'), rules: { penaltyPerWrong: penalty }, params: { level: 5, limitSec, yearFrom, yearTo: 2099 },
      endedAt: ended ? 1 : undefined,
    });
    const log = { sessions: [c('ok', 60, 1), c('long', 120, 1), c('pen', 60, 0), c('yr', 60, 1, 1900), c('cut', 60, 1, 1600, false)], items: [] };
    expect(contestSessions(log, k).map((s) => s.id)).toEqual(['ok']);
  });
});
