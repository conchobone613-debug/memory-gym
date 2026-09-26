import { describe, expect, it } from 'vitest';
import type { CalcItem, CalcSession } from '../db/db';
import { CALC_EVENTS } from '../data/events';
import { defaultRules } from '../lib/rules';
import { CALC_MAKERS } from './makers';
import { seeded } from './rng';
import { sqrtSig } from './bigmath';
import {
  CALC_LADDERS, calcLadderStatus, calcLevelItems, calcLevels, calcPracticeIds, currentCalcLevel, evalCalcLevel, isContestLevel, nextSuggestion,
  sessionFlashMs,
} from './ladders';

const SQ = calcLevels('sqrt');
/** 최근 것부터 n문항: 앞의 correct 개는 맞힘, 반응시간은 모두 rtMs */
const items = (n: number, correct: number, rtMs: number) =>
  Array.from({ length: n }, (_, i) => ({ isCorrect: i < correct, rtMs }));

let k = 0;
/** 제곱근 연습 한 판 */
function run(level: number, startedAt: number, count: number, ok: number, rtMs: number) {
  const id = `q${k++}`;
  const s: CalcSession = {
    id, disciplineId: 'sqrt', mode: 'practice', rules: {}, params: { level, items: count }, seed: 'x', startedAt,
    endedAt: startedAt + count * rtMs, correct: ok, wrong: count - ok, score: ok,
  };
  const its: CalcItem[] = Array.from({ length: count }, (_, i) => ({
    id: `${id}-${i}`, sessionId: id, index: i, kind: 'sqrt', prompt: '√1234', expected: '35.12', answered: i < ok ? '35.12' : '35.13',
    isCorrect: i < ok, rtMs, shownAt: startedAt + i * rtMs,
  }));
  return { s, items: its };
}

describe('계산 사다리 — 칸 정의', () => {
  it('열린 계산 종목(달력 제외)은 사다리가 있고, 마지막 칸만 모의 대회', () => {
    for (const ev of CALC_EVENTS.filter((e) => e.status === 'ready' && e.id !== 'calendar')) {
      const levels = calcLevels(ev.id);
      expect(levels.length, ev.id).toBeGreaterThan(1);
      expect(levels.map((l) => l.n), ev.id).toEqual(levels.map((_, i) => i + 1));
      expect(levels.map((l) => l.id), ev.id).toEqual(levels.map((l) => `${ev.id}-${l.n}`));
      expect(levels.map(isContestLevel), ev.id).toEqual(levels.map((_, i) => i === levels.length - 1));
      for (const l of levels) expect(!!l.params, l.id).toBe(!!l.pass);
    }
  });

  it('제곱근 네 칸 — 기본값', () => {
    expect(SQ.map((l) => l.name)).toEqual(['4자리 · 유효 4', '6자리 · 유효 6', '6자리 · 유효 8', '모의 대회']);
    expect(SQ.map((l) => l.params)).toEqual([{ digits: 4, sig: 4 }, { digits: 6, sig: 6 }, { digits: 6, sig: 8 }, undefined]);
    expect(SQ.map((l) => l.pass?.medianMs)).toEqual([30_000, 60_000, 90_000, undefined]);
    expect(SQ.map((l) => l.perItemMs)).toEqual([30_000, 60_000, 90_000, 90_000]);
    expect(SQ.slice(0, 3).every((l) => l.pass?.items === 20 && l.pass.accuracy === 0.9)).toBe(true);
    expect(CALC_LADDERS.calendar).toBeUndefined(); // 달력은 자기 사다리(calendarLadder)
  });
});

describe('계산 칸 평가', () => {
  it('기록이 없으면 막대는 비어 있고 통과가 아니다', () => {
    const s = evalCalcLevel(SQ[0], []);
    expect(s.passed).toBe(false);
    expect(s.bars.map((b) => [b.label, b.ratio, b.text, b.met])).toEqual([
      ['문항 20', 0, '0/20', false], ['정확 90%', 0, '—', false], ['반응 30초', 0, '—', false],
    ]);
  });

  it('경계: 20문항 · 18개(90%) · 중앙 30초 = 통과, 하나라도 모자라면 아니다', () => {
    expect(evalCalcLevel(SQ[0], items(20, 18, 30_000)).passed).toBe(true);
    expect(evalCalcLevel(SQ[0], items(19, 19, 1000)).passed).toBe(false);
    expect(evalCalcLevel(SQ[0], items(20, 17, 1000)).passed).toBe(false);
    const slow = evalCalcLevel(SQ[0], items(20, 20, 30_001));
    expect(slow.passed).toBe(false);
    expect(slow.bars[2].met).toBe(false);
  });

  it('최근 20문항만 보고, 모름(0ms)은 중앙 반응 표본에서 뺀다', () => {
    expect(evalCalcLevel(SQ[1], [...items(20, 20, 40_000), ...items(10, 0, 99_000)])).toMatchObject({ attempts: 20, accuracy: 1, passed: true });
    expect(evalCalcLevel(SQ[1], [{ isCorrect: false, rtMs: 0 }, { isCorrect: true, rtMs: 20_000 }, { isCorrect: true, rtMs: 40_000 }]).medianRt).toBe(30_000);
  });

  it('모의 대회 칸은 막대가 없고 통과하지 않는다', () => {
    expect(evalCalcLevel(SQ[3], items(50, 50, 1000))).toMatchObject({ bars: [], passed: false });
  });
});

describe('기록에서 사다리 상태', () => {
  const T = 1_800_000_000_000;

  it('칸마다 그 칸 연습 문항만, 최근 것이 앞', () => {
    const a = run(1, T - 2000_000, 20, 20, 20_000);
    const b = run(2, T - 1000_000, 5, 3, 50_000);
    const contest: CalcSession = { ...run(0, T, 0, 0, 0).s, id: 'ct', mode: 'contest', params: { level: 4 } };
    const log = { sessions: [a.s, b.s, contest], items: [...a.items, ...b.items] };
    expect(calcLevelItems(log, 2).map((i) => i.sessionId)).toEqual(Array(5).fill(b.s.id));
    expect(calcLevelItems(log, 2)[0].shownAt).toBeGreaterThan(calcLevelItems(log, 2)[4].shownAt);
    const st = calcLadderStatus('sqrt', log);
    expect(st.map((x) => x.passed)).toEqual([true, false, false, false]);
    expect(currentCalcLevel('sqrt', st).n).toBe(2);
  });

  it('지금 칸 — 사다리 표에 적힌 칸(한 칸 내리기)이 먼저, 모두 통과면 모의 대회', () => {
    const empty = calcLadderStatus('sqrt', { sessions: [], items: [] });
    expect(currentCalcLevel('sqrt', empty).n).toBe(1);
    expect(currentCalcLevel('sqrt', empty, 'sqrt-3').n).toBe(3);
    expect(currentCalcLevel('sqrt', empty, 'calendar-2').n).toBe(1);
    const runs = [1, 2, 3].map((lv) => run(lv, T + lv, 20, 20, 10_000));
    const all = calcLadderStatus('sqrt', { sessions: runs.map((r) => r.s), items: runs.flatMap((r) => r.items) });
    expect(currentCalcLevel('sqrt', all).n).toBe(4);
  });

  it('다음 칸 제안 — 그 칸을 통과했을 때만, 자동으로 올리지 않는다', () => {
    const a = run(1, T, 20, 19, 20_000);
    const st = calcLadderStatus('sqrt', { sessions: [a.s], items: a.items });
    expect(nextSuggestion('sqrt', st, 1)?.name).toBe('6자리 · 유효 6');
    expect(nextSuggestion('sqrt', st, 2)).toBeNull();
    const top = [1, 2, 3].map((lv) => run(lv, T + lv, 20, 20, 10_000));
    const st3 = calcLadderStatus('sqrt', { sessions: top.map((r) => r.s), items: top.flatMap((r) => r.items) });
    expect(nextSuggestion('sqrt', st3, 3)?.n).toBe(4);
    expect(nextSuggestion('sqrt', st3, 4)).toBeNull();
    /* 제안은 기록만 보고, 지금 칸은 바꾸지 않는다 */
    expect(currentCalcLevel('sqrt', st, 'sqrt-1').n).toBe(1);
  });
});

describe('문항 만들기 표', () => {
  const sqrt = CALC_EVENTS.find((e) => e.id === 'sqrt')!;
  const rules = defaultRules(sqrt.rules);

  it('열린 계산 종목(달력 제외)마다 만들기가 있다', () => {
    for (const ev of CALC_EVENTS.filter((e) => e.status === 'ready' && e.id !== 'calendar')) expect(CALC_MAKERS[ev.id], ev.id).toBeTruthy();
  });

  it('연습은 칸 설정, 모의 대회는 규정 — 끝자리는 둘 다 규정', () => {
    const m = CALC_MAKERS.sqrt;
    expect(m.params({ ...rules, rounding: 'round' }, SQ[0])).toEqual({ digits: 4, sig: 4, rounding: 'round' });
    expect(m.params(rules, SQ[3])).toEqual({ digits: 6, sig: 8, rounding: 'trunc' });
    const q = m.make(seeded('m'), m.params(rules, SQ[0]));
    expect(q.prompt).toMatch(/^√\d{4}$/);
    expect(q.expected).toBe(sqrtSig(BigInt(q.prompt.slice(1)), 4, 'trunc'));
  });
});

describe('덧셈·곱셈 사다리 — 기본값', () => {
  it('곱셈 여덟 칸 — 2×2 부터 8×8, 마지막은 모의 대회', () => {
    const m = calcLevels('multiplication');
    expect(m.map((l) => l.name)).toEqual(['2×2', '3×3', '4×4', '5×5', '6×6', '7×7', '8×8', '모의 대회']);
    expect(m.slice(0, 7).map((l) => l.params)).toEqual([2, 3, 4, 5, 6, 7, 8].map((d) => ({ digitsA: d, digitsB: d })));
    expect(m.map((l) => l.perItemMs)).toEqual([8, 20, 40, 70, 110, 160, 220, 220].map((s) => s * 1000));
    expect(m.map((l) => l.pass?.medianMs)).toEqual([...[8, 20, 40, 70, 110, 160, 220].map((s) => s * 1000), undefined]);
    expect(m.slice(0, 7).every((l) => l.pass?.items === 20 && l.pass.accuracy === 0.9)).toBe(true);
  });

  it('덧셈 여섯 칸 — 2자리 × 5개 부터 10자리 × 10개, 마지막은 모의 대회', () => {
    const a = calcLevels('addition');
    expect(a.map((l) => l.name)).toEqual(['2자리 × 5개', '3자리 × 5개', '4자리 × 10개', '6자리 × 10개', '10자리 × 10개', '모의 대회']);
    expect(a.map((l) => l.params)).toEqual([
      { digits: 2, terms: 5 }, { digits: 3, terms: 5 }, { digits: 4, terms: 10 }, { digits: 6, terms: 10 }, { digits: 10, terms: 10 }, undefined,
    ]);
    expect(a.map((l) => l.perItemMs)).toEqual([10, 15, 40, 60, 100, 100].map((s) => s * 1000));
    expect(a.slice(0, 5).every((l) => l.pass?.items === 20 && l.pass.accuracy === 0.9 && l.pass.medianMs === l.perItemMs)).toBe(true);
  });
});

describe('플래시 판 거르기', () => {
  const T = 1_800_000_000_000;
  /** 덧셈 연습 한 판 — flashMs 가 있으면 플래시 판 */
  function addRun(level: number, startedAt: number, count: number, flashMs = 0) {
    const r = run(level, startedAt, count, count, 3000);
    const s: CalcSession = { ...r.s, disciplineId: 'addition', params: { ...r.s.params, ...(flashMs ? { flash: 1, intervalMs: flashMs } : {}) } };
    return { s, items: r.items.map((i) => ({ ...i, kind: 'add' })) };
  }

  it('세션의 플래시 간격 — 플래시 판이 아니면 0', () => {
    expect(sessionFlashMs({ level: 1, items: 20 })).toBe(0);
    expect(sessionFlashMs({ level: 1, flash: 1, intervalMs: 800 })).toBe(800);
    expect(sessionFlashMs({ level: 1, flash: 0, intervalMs: 800 })).toBe(0);
  });

  it('같은 칸이라도 플래시 판끼리(같은 간격)만, 사다리는 플래시 아닌 판만', () => {
    const plain = addRun(1, T, 20);
    const f1 = addRun(1, T + 1, 20, 1000);
    const f2 = addRun(1, T + 2, 20, 500);
    const log = { sessions: [plain.s, f1.s, f2.s], items: [...plain.items, ...f1.items, ...f2.items] };
    expect([...calcPracticeIds(log, 1)]).toEqual([plain.s.id]);
    expect([...calcPracticeIds(log, 1, 1000)]).toEqual([f1.s.id]);
    expect([...calcPracticeIds(log, 1, 500)]).toEqual([f2.s.id]);
    expect(new Set(calcLevelItems(log, 1).map((i) => i.sessionId))).toEqual(new Set([plain.s.id]));
    /* 플래시 판만 있으면 사다리는 비어 있다 */
    const only = { sessions: [f1.s], items: f1.items };
    expect(calcLadderStatus('addition', only)[0]).toMatchObject({ attempts: 0, passed: false });
  });
});
