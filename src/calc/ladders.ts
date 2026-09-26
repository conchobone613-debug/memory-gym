import type { CalcItem, RuleValues } from '../db/db';
import type { CalcLog } from '../db/calcLog';
import type { OutcomeGoal } from '../lib/outcome';
import { median } from '../lib/srs';
import type { LevelPass } from './calendarLadder';

/*
 * 계산 사다리(달력 제외) — 종목마다 부하가 커지는 칸과 통과 기준. 칸 정의와 기준값은 이 파일 한곳에 둔다.
 * 판정은 달력 사다리와 같다: 그 칸 연습 문항 중 최근 pass.items 문항의 정확도와 중앙 반응시간(모름 제외).
 * 마지막 칸은 모의 대회(params·pass 없음) — 통과 기준 없이 점수 기록을 쌓는 자리다.
 */

export interface CalcLevelDef {
  n: number;
  /** `${종목 id}-${n}` */
  id: string;
  name: string;
  /** 한 줄 설명(평문) */
  what: string;
  /** 연습 설정(규정 위에 덮는다). 없으면 모의 대회 칸 */
  params?: RuleValues;
  /** 없으면 모의 대회 칸 */
  pass?: LevelPass;
  /** 기록이 없을 때 한 문항 예상 시간(ms) — 스승님 예상 시간 */
  perItemMs: number;
}

const pass = (medianMs: number): LevelPass => ({ items: 20, accuracy: 0.9, medianMs });

export const CALC_LADDERS: Record<string, CalcLevelDef[]> = {
  sqrt: [
    { n: 1, id: 'sqrt-1', name: '4자리 · 유효 4', what: '4자리 수의 제곱근을 유효숫자 4자리까지', params: { digits: 4, sig: 4 }, pass: pass(30_000), perItemMs: 30_000 },
    { n: 2, id: 'sqrt-2', name: '6자리 · 유효 6', what: '6자리 수의 제곱근을 유효숫자 6자리까지', params: { digits: 6, sig: 6 }, pass: pass(60_000), perItemMs: 60_000 },
    { n: 3, id: 'sqrt-3', name: '6자리 · 유효 8', what: '6자리 수의 제곱근을 유효숫자 8자리까지', params: { digits: 6, sig: 8 }, pass: pass(90_000), perItemMs: 90_000 },
    { n: 4, id: 'sqrt-4', name: '모의 대회', what: '규정대로 풀고 점수를 겨룹니다', perItemMs: 90_000 },
  ],
  addition: [
    { n: 1, id: 'addition-1', name: '2자리 × 5개', what: '2자리 수 5개 더하기', params: { digits: 2, terms: 5 }, pass: pass(10_000), perItemMs: 10_000 },
    { n: 2, id: 'addition-2', name: '3자리 × 5개', what: '3자리 수 5개 더하기', params: { digits: 3, terms: 5 }, pass: pass(15_000), perItemMs: 15_000 },
    { n: 3, id: 'addition-3', name: '4자리 × 10개', what: '4자리 수 10개 더하기', params: { digits: 4, terms: 10 }, pass: pass(40_000), perItemMs: 40_000 },
    { n: 4, id: 'addition-4', name: '6자리 × 10개', what: '6자리 수 10개 더하기', params: { digits: 6, terms: 10 }, pass: pass(60_000), perItemMs: 60_000 },
    { n: 5, id: 'addition-5', name: '10자리 × 10개', what: '10자리 수 10개 더하기', params: { digits: 10, terms: 10 }, pass: pass(100_000), perItemMs: 100_000 },
    { n: 6, id: 'addition-6', name: '모의 대회', what: '규정대로 풀고 점수를 겨룹니다', perItemMs: 100_000 },
  ],
  multiplication: [
    { n: 1, id: 'multiplication-1', name: '2×2', what: '2자리 수끼리 곱하기', params: { digitsA: 2, digitsB: 2 }, pass: pass(8_000), perItemMs: 8_000 },
    { n: 2, id: 'multiplication-2', name: '3×3', what: '3자리 수끼리 곱하기', params: { digitsA: 3, digitsB: 3 }, pass: pass(20_000), perItemMs: 20_000 },
    { n: 3, id: 'multiplication-3', name: '4×4', what: '4자리 수끼리 곱하기', params: { digitsA: 4, digitsB: 4 }, pass: pass(40_000), perItemMs: 40_000 },
    { n: 4, id: 'multiplication-4', name: '5×5', what: '5자리 수끼리 곱하기', params: { digitsA: 5, digitsB: 5 }, pass: pass(70_000), perItemMs: 70_000 },
    { n: 5, id: 'multiplication-5', name: '6×6', what: '6자리 수끼리 곱하기', params: { digitsA: 6, digitsB: 6 }, pass: pass(110_000), perItemMs: 110_000 },
    { n: 6, id: 'multiplication-6', name: '7×7', what: '7자리 수끼리 곱하기', params: { digitsA: 7, digitsB: 7 }, pass: pass(160_000), perItemMs: 160_000 },
    { n: 7, id: 'multiplication-7', name: '8×8', what: '8자리 수끼리 곱하기', params: { digitsA: 8, digitsB: 8 }, pass: pass(220_000), perItemMs: 220_000 },
    { n: 8, id: 'multiplication-8', name: '모의 대회', what: '규정대로 풀고 점수를 겨룹니다', perItemMs: 220_000 },
  ],
};

/** 종목의 칸들(사다리가 없으면 빈 목록) */
export const calcLevels = (eventId: string): CalcLevelDef[] => CALC_LADDERS[eventId] ?? [];

/** 마지막 칸 = 모의 대회 */
export const isContestLevel = (l: CalcLevelDef) => !l.pass;

export interface CalcLevelStatus {
  level: CalcLevelDef;
  /** 최근 창 안의 문항 수 */
  attempts: number;
  accuracy: number;
  medianRt: number;
  /** 세 조건(문항 수 · 정확도 · 중앙 반응) — 결과 화면 목표 막대 모양 그대로. 모의 대회 칸은 빈 목록 */
  bars: OutcomeGoal[];
  passed: boolean;
}

/** 이 칸의 연습 문항(최근 것부터)으로 세 조건의 진행률과 통과 여부 — 달력 evalLevel 과 같은 규칙 */
export function evalCalcLevel(level: CalcLevelDef, recent: Pick<CalcItem, 'isCorrect' | 'rtMs'>[]): CalcLevelStatus {
  const p = level.pass;
  if (!p) return { level, attempts: 0, accuracy: 0, medianRt: 0, bars: [], passed: false };
  const win = recent.slice(0, p.items);
  const n = win.length;
  const accuracy = n ? win.filter((i) => i.isCorrect).length / n : 0;
  /* 모름(rtMs 0)은 표본에서 뺀다 — 넣으면 중앙값이 거짓으로 빨라진다 */
  const medianRt = Math.round(median(win.map((i) => i.rtMs).filter((x) => x > 0)));
  const bars: OutcomeGoal[] = [
    { label: `문항 ${p.items}`, ratio: Math.min(1, n / p.items), text: `${n}/${p.items}`, met: n >= p.items },
    {
      label: `정확 ${Math.round(p.accuracy * 100)}%`, ratio: n ? Math.min(1, accuracy / p.accuracy) : 0,
      text: n ? `${Math.round(accuracy * 100)}%` : '—', met: n > 0 && accuracy >= p.accuracy - 1e-9,
    },
    {
      label: `반응 ${p.medianMs / 1000}초`, ratio: medianRt ? Math.min(1, p.medianMs / medianRt) : 0,
      text: medianRt ? `${(medianRt / 1000).toFixed(2)}초` : '—', met: medianRt > 0 && medianRt <= p.medianMs,
    },
  ];
  return { level, attempts: n, accuracy, medianRt, bars, passed: bars.every((b) => b.met) };
}

/** 세션의 플래시 표시 간격(ms). 플래시 판이 아니면 0 — 세션 params 의 flash 1 · intervalMs */
export const sessionFlashMs = (params: RuleValues): number => (Number(params.flash) ? Number(params.intervalMs) || 0 : 0);

/**
 * 이 칸의 연습 세션 id(연습 판은 params.level 로 칸을 가린다). flashMs = 그 간격의 플래시 판만, 0 = 플래시 아닌 판만.
 * 플래시 판은 반응시간을 수가 다 지나간 뒤부터 재 잣대가 달라 사다리(calcLevelItems)에도 들지 않는다.
 */
export function calcPracticeIds(log: CalcLog, n: number, flashMs = 0): Set<string> {
  return new Set(log.sessions
    .filter((s) => s.mode === 'practice' && Number(s.params.level) === n && sessionFlashMs(s.params) === flashMs)
    .map((s) => s.id));
}

/** 이 칸의 연습 문항, 최근 것이 앞 */
export function calcLevelItems(log: CalcLog, n: number): CalcItem[] {
  const ids = calcPracticeIds(log, n);
  return log.items.filter((i) => ids.has(i.sessionId)).sort((a, b) => b.shownAt - a.shownAt || b.index - a.index);
}

/** 종목 하나의 칸마다 상태. log 는 그 종목의 기록(loadCalcLog(eventId)) */
export const calcLadderStatus = (eventId: string, log: CalcLog): CalcLevelStatus[] =>
  calcLevels(eventId).map((l) => evalCalcLevel(l, calcLevelItems(log, l.n)));

/** 지금 칸 = 사다리 표(ladderState, ladderId = 종목 id)에 적힌 칸이 있으면 그 칸(한 칸 내리기), 없으면 통과 못 한 첫 칸 */
export function currentCalcLevel(eventId: string, statuses: CalcLevelStatus[], stored?: string): CalcLevelDef {
  const levels = calcLevels(eventId);
  return levels.find((l) => l.id === stored) ?? statuses.find((s) => !s.passed)?.level ?? levels[0];
}

/** 적응형 난이도 제안 — 이번 판을 넣은 뒤 그 칸이 통과면 다음 칸. 자동으로 올리지 않는다(화면이 권하기만) */
export function nextSuggestion(eventId: string, statuses: CalcLevelStatus[], playedLevel: number): CalcLevelDef | null {
  if (!statuses.find((s) => s.level.n === playedLevel)?.passed) return null;
  return calcLevels(eventId).find((l) => l.n === playedLevel + 1) ?? null;
}
