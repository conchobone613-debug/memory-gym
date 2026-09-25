import { randInt, type Rng } from './rng';

/*
 * 달력 계산 — 날짜의 요일. 대회 범위 1600–2099 는 모두 그레고리력이다.
 *
 * 계산법: 가장 널리 쓰는 '코드 더하기' 방식(회장 결정 2026-09-25).
 *   요일 = (일 + 월 코드 + 연도 코드) mod 7,  0 = 일요일 … 6 = 토요일
 *   연도 코드 = (yy + ⌊yy/4⌋ + 세기 코드) mod 7        yy = 연도 끝 두 자리
 *   세기 코드: 1600년대 6 · 1700년대 4 · 1800년대 2 · 1900년대 0 · 2000년대 6 (400년마다 되풀이)
 *   월 코드: 1월 0 · 2월 3 · 3월 3 · 4월 6 · 5월 1 · 6월 4 · 7월 6 · 8월 2 · 9월 5 · 10월 0 · 11월 3 · 12월 5
 *            윤년의 1·2월은 하나 뺀다(1월 6 · 2월 2).
 * 연습의 단계 입력(연도 코드 → 월 코드 → 요일)도 이 코드를 그대로 쓴다.
 * 정답은 이 계산이 낸다. 시험(calendar.test.ts)이 1600-01-01 ~ 2099-12-31 모든 날짜를 브라우저 날짜 계산과 대조한다.
 */

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;
export const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

const MONTH_CODE = [0, 3, 3, 6, 1, 4, 6, 2, 5, 0, 3, 5];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1];
}

/** 세기 코드. 400년마다 6·4·2·0 을 되풀이한다. */
export function centuryCode(y: number): number {
  return [6, 4, 2, 0][Math.floor(y / 100) % 4];
}

/** 두 자리 연도만의 코드 (yy + ⌊yy/4⌋) mod 7 — 세기 보정 전 */
export function yyCode(y: number): number {
  const yy = y % 100;
  return (yy + Math.floor(yy / 4)) % 7;
}

/** 연도 코드 = 두 자리 코드 + 세기 코드 (mod 7) */
export function yearCode(y: number): number {
  return (yyCode(y) + centuryCode(y)) % 7;
}

/** 월 코드. 윤년 1·2월 보정 포함 */
export function monthCode(y: number, m: number): number {
  const c = MONTH_CODE[m - 1];
  return isLeap(y) && m <= 2 ? (c + 6) % 7 : c;
}

/** 요일 0(일)~6(토) */
export function weekday(y: number, m: number, d: number): number {
  return (d + monthCode(y, m) + yearCode(y)) % 7;
}

export interface CalDate { y: number; m: number; d: number }

/** 연·월·일 → 그 해 1월 1일부터 센 날 수를 쓰지 않고, 범위 안 날짜를 고르게 뽑는다 */
export function randomDate(rng: Rng, yearFrom: number, yearTo: number): CalDate {
  const lo = Math.min(yearFrom, yearTo);
  const hi = Math.max(yearFrom, yearTo);
  /* 해마다 날 수가 달라(윤년) 해를 먼저 고르면 윤년 날짜가 덜 나온다 — 날 수로 고른다 */
  let total = 0;
  for (let y = lo; y <= hi; y++) total += isLeap(y) ? 366 : 365;
  let k = randInt(rng, total);
  for (let y = lo; y <= hi; y++) {
    const n = isLeap(y) ? 366 : 365;
    if (k >= n) { k -= n; continue; }
    for (let m = 1; m <= 12; m++) {
      const dm = daysInMonth(y, m);
      if (k < dm) return { y, m, d: k + 1 };
      k -= dm;
    }
  }
  return { y: lo, m: 1, d: 1 }; // 닿지 않는다
}

/** 요일 번호 방식(규정 weekBase). sun0: 일0 월1 … 토6 / mon1: 월1 … 토6 일7 */
export type WeekBase = 'sun0' | 'mon1';

/** 요일 → 누를 숫자 */
export function weekdayKey(wd: number, base: WeekBase): number {
  return base === 'mon1' && wd === 0 ? 7 : wd;
}

/** 누른 숫자 → 요일. 모르는 숫자면 null */
export function keyToWeekday(key: number, base: WeekBase): number | null {
  if (base === 'mon1') {
    if (key >= 1 && key <= 6) return key;
    return key === 7 ? 0 : null;
  }
  return key >= 0 && key <= 6 ? key : null;
}

/** 화면에 늘어놓을 요일 버튼 순서 */
export function weekdayOrder(base: WeekBase): number[] {
  return base === 'mon1' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
}

export const fmtDate = ({ y, m, d }: CalDate) => `${y}. ${m}. ${d}.`;
