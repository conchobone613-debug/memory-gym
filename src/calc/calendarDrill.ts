import {
  centuryCode, isLeap, monthCode, randomDate, weekday, yearCode,
  WEEKDAY_LONG, type CalDate,
} from './calendar';
import { randInt, type Rng } from './rng';

/*
 * 달력 문제 만들기와 채점 — 화면과 떨어진 순수 함수. 정답은 calendar.ts 가 낸다.
 *
 * 연습 드릴 셋(기획서 §5.2):
 *   year  — 연도 → 연도 코드(0~6)
 *   code  — 월 코드 · 세기 코드(0~6). 윤년 1·2월은 '윤년' 표시와 함께 낸다
 *   full  — 날짜 → 요일. steps 를 켜면 연도 코드 → 월 코드 → 요일을 차례로 받아 단계마다 시간을 잰다
 * 모의 대회는 full 을 제한시간 안에 최대한 많이(단계 입력 없음).
 */

export type CalDrill = 'year' | 'code' | 'full';

export interface CalStepSpec {
  /** 단계 이름(평문) — 결과 화면 '단계별 평균 시간' 에 쓴다 */
  name: '연도 코드' | '월 코드' | '요일';
  expected: number;
}

export interface CalItem {
  kind: CalDrill | 'month' | 'century';
  /** 문제 카드에 보일 글자 */
  prompt: string;
  /** 문제 아래 작은 안내(예: '윤년') */
  note?: string;
  /** 최종 정답(0~6) */
  expected: number;
  date?: CalDate;
  /** full + 단계 입력일 때만 */
  steps?: CalStepSpec[];
}

export interface CalParams {
  yearFrom: number;
  yearTo: number;
  /** full 에서 단계 입력 */
  steps?: boolean;
}

export function makeItem(drill: CalDrill, p: CalParams, rng: Rng): CalItem {
  if (drill === 'year') {
    const lo = Math.min(p.yearFrom, p.yearTo);
    const y = lo + randInt(rng, Math.abs(p.yearTo - p.yearFrom) + 1);
    return { kind: 'year', prompt: String(y), expected: yearCode(y) };
  }
  if (drill === 'code') {
    /* 월 12 + 윤년 1·2월 2 + 세기 5 — 월 코드가 더 자주 나오도록 이 비율 그대로 고른다 */
    const k = randInt(rng, 19);
    if (k < 12) return { kind: 'month', prompt: `${k + 1}월`, expected: monthCode(2023, k + 1) };
    if (k < 14) {
      const m = k - 11;
      return { kind: 'month', prompt: `${m}월`, note: '윤년', expected: monthCode(2024, m) };
    }
    const c = 1600 + (k - 14) * 100;
    return { kind: 'century', prompt: `${c}년대`, expected: centuryCode(c) };
  }
  const date = randomDate(rng, p.yearFrom, p.yearTo);
  const item: CalItem = { kind: 'full', prompt: fmtPrompt(date), expected: weekday(date.y, date.m, date.d), date };
  if (isLeap(date.y) && date.m <= 2) item.note = '윤년';
  if (p.steps) {
    item.steps = [
      { name: '연도 코드', expected: yearCode(date.y) },
      { name: '월 코드', expected: monthCode(date.y, date.m) },
      { name: '요일', expected: item.expected },
    ];
  }
  return item;
}

/** 문제 카드 글자. 자릿수가 흔들리지 않게 월·일은 두 자리로. */
export function fmtPrompt({ y, m, d }: CalDate): string {
  return `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
}

/** 틀렸을 때 붙잡힘 칸에 보일 풀이 — 코드 더하기를 그대로 적는다(AI 가 아니라 계산으로). */
export function explain(item: CalItem): string {
  if (item.kind === 'year' && item.prompt) {
    const y = Number(item.prompt);
    const yy = y % 100;
    return `${yy} + ${Math.floor(yy / 4)} + 세기 ${centuryCode(y)} = ${yy + Math.floor(yy / 4) + centuryCode(y)} → 7로 나눈 나머지 ${item.expected}`;
  }
  if (item.kind === 'month') return `${item.prompt}${item.note ? '(윤년)' : ''} 코드는 ${item.expected}`;
  if (item.kind === 'century') return `${item.prompt} 세기 코드는 ${item.expected}`;
  const { y, m, d } = item.date!;
  const yc = yearCode(y), mc = monthCode(y, m);
  return `일 ${d} + 월 ${mc} + 연도 ${yc} = ${d + mc + yc} → 7로 나눈 나머지 ${item.expected} (${WEEKDAY_LONG[item.expected]})`;
}

/** 모의 대회 점수: 맞힌 수 − 오답 × 감점. 0 아래로 내려가지 않는다. */
export function contestScore(correct: number, wrong: number, penaltyPerWrong: number): number {
  return Math.max(0, correct - wrong * Math.max(0, penaltyPerWrong));
}

/** 단계별 평균 시간(ms) — 느린 단계를 짚는다. 잰 값이 없는 단계는 0. */
export function stepAverages(items: { steps?: { name: string; ms: number }[] }[]): { name: string; avgMs: number; n: number }[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const it of items) {
    for (const s of it.steps ?? []) {
      if (!(s.ms > 0)) continue;
      const a = acc.get(s.name) ?? { sum: 0, n: 0 };
      a.sum += s.ms;
      a.n += 1;
      acc.set(s.name, a);
    }
  }
  return ['연도 코드', '월 코드', '요일']
    .filter((name) => acc.has(name))
    .map((name) => { const a = acc.get(name)!; return { name, avgMs: Math.round(a.sum / a.n), n: a.n }; });
}
