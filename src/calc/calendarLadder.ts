import type { CalcItem, CalcSession, RuleValues } from '../db/db';
import type { CalcLog } from '../db/calcLog';
import type { OutcomeGoal } from '../lib/outcome';
import { median } from '../lib/srs';
import type { CalDrill } from './calendarDrill';

/*
 * 달력 사다리 — 부하가 커지는 다섯 칸과 통과 기준(기획서 §6.6). 칸 정의와 기준값은 이 파일 한곳에 둔다.
 * 판정은 모두 기록에서 한다: 그 칸 연습 문항 중 최근 30문항의 정확도와 중앙 반응시간(모름 제외).
 * 마지막 칸(1분 모의 대회)은 통과 기준 없이 점수 기록을 쌓는 자리다.
 */

export const CALENDAR_LADDER = 'calendar';

export interface LevelPass {
  /** 최근 몇 문항으로 보나 */
  items: number;
  accuracy: number;
  /** 중앙 반응시간 상한(ms) */
  medianMs: number;
}

export interface CalLevel {
  n: number;
  id: string;
  name: string;
  drill: CalDrill | 'contest';
  /** 연도 범위. 없으면 규정(yearFrom~yearTo) */
  years?: [number, number];
  /** 한 줄 설명(평문) */
  what: string;
  /** 없으면 통과 기준이 없는 칸(모의 대회) */
  pass?: LevelPass;
}

const pass = (medianMs: number): LevelPass => ({ items: 30, accuracy: 0.95, medianMs });

export const CAL_LEVELS: CalLevel[] = [
  { n: 1, id: 'calendar-1', name: '연도 코드', drill: 'year', years: [1600, 2099], what: '연도를 보고 연도 코드(0~6)', pass: pass(3000) },
  { n: 2, id: 'calendar-2', name: '월·세기 코드', drill: 'code', what: '월 코드와 세기 코드(0~6)', pass: pass(1500) },
  { n: 3, id: 'calendar-3', name: '한 세기', drill: 'full', years: [1900, 1999], what: '1900년대 날짜의 요일', pass: pass(8000) },
  { n: 4, id: 'calendar-4', name: '전체 범위', drill: 'full', what: '규정 범위 날짜의 요일', pass: pass(6000) },
  { n: 5, id: 'calendar-5', name: '1분 모의 대회', drill: 'contest', what: '제한시간 안에 날짜의 요일을 최대한 많이' },
];

/** 이 칸의 연도 범위 — 칸이 정하지 않으면 규정 값 */
export function yearsFor(level: CalLevel, rules: RuleValues): [number, number] {
  if (level.years) return level.years;
  const a = Number(rules.yearFrom);
  const b = Number(rules.yearTo);
  return [Math.min(a, b), Math.max(a, b)];
}

export interface LevelStatus {
  level: CalLevel;
  /** 최근 창 안의 문항 수 */
  attempts: number;
  accuracy: number;
  medianRt: number;
  /** 세 조건(문항 수 · 정확도 · 중앙 반응) — 결과 화면 목표 막대 모양 그대로. 모의 대회 칸은 빈 목록 */
  bars: OutcomeGoal[];
  passed: boolean;
}

/** 이 칸의 연습 문항(최근 것부터)으로 세 조건의 진행률과 통과 여부 */
export function evalLevel(level: CalLevel, recent: Pick<CalcItem, 'isCorrect' | 'rtMs'>[]): LevelStatus {
  const p = level.pass;
  if (!p) return { level, attempts: 0, accuracy: 0, medianRt: 0, bars: [], passed: false };
  const win = recent.slice(0, p.items);
  const n = win.length;
  const accuracy = n ? win.filter((i) => i.isCorrect).length / n : 0;
  /* 모름(rtMs 0)은 표본에서 뺀다 — 넣으면 중앙값이 거짓으로 빨라진다(기초 드릴과 같은 규칙) */
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

/** 지금 칸 = 사다리 표에 적힌 칸이 있으면 그 칸(한 칸 내리기), 없으면 통과 못 한 첫 칸 */
export function currentLevel(statuses: LevelStatus[], stored?: string): CalLevel {
  return CAL_LEVELS.find((l) => l.id === stored) ?? statuses.find((s) => !s.passed)?.level ?? CAL_LEVELS[0];
}

/**
 * 이 칸의 연습 세션 id. steps 를 주면 단계 입력 설정이 같은 판만 — 단계 입력 판은 한 문항에 세 번 눌러 늘 느리므로
 * 신기록·아까움은 같은 설정끼리 겨룬다. 사다리 평가(levelItems)는 칸 단위 그대로.
 */
export function practiceIds(log: CalcLog, n: number, steps?: boolean): Set<string> {
  return new Set(log.sessions.filter((s) => s.mode === 'practice' && Number(s.params.level) === n
    && (steps == null || Number(s.params.steps || 0) === (steps ? 1 : 0))).map((s) => s.id));
}

/** 모의 대회 조건 — 제한시간·오답 감점·연도 범위가 다르면 점수를 겨루지 않는다 */
export interface ContestKey { limitSec: number; penalty: number; yearFrom: number; yearTo: number }

/** 같은 조건으로 끝까지 치른 모의 대회(취소한 판은 endedAt 이 없다) */
export function contestSessions(log: CalcLog, k: ContestKey): CalcSession[] {
  return log.sessions.filter((s) => s.mode === 'contest' && !!s.endedAt
    && Number(s.params.limitSec) === k.limitSec && (Number(s.rules.penaltyPerWrong) || 0) === k.penalty
    && Number(s.params.yearFrom) === k.yearFrom && Number(s.params.yearTo) === k.yearTo);
}

/** 이 칸의 연습 문항, 최근 것이 앞 */
export function levelItems(log: CalcLog, n: number): CalcItem[] {
  const ids = practiceIds(log, n);
  return log.items.filter((i) => ids.has(i.sessionId)).sort((a, b) => b.shownAt - a.shownAt || b.index - a.index);
}

export const ladderStatus = (log: CalcLog): LevelStatus[] => CAL_LEVELS.map((l) => evalLevel(l, levelItems(log, l.n)));
