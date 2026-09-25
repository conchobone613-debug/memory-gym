import { describe, expect, it } from 'vitest';
import {
  centuryCode, daysInMonth, isLeap, keyToWeekday, monthCode, randomDate, weekday, weekdayKey, weekdayOrder, yearCode, yyCode,
} from './calendar';
import { seeded } from './rng';

/** 대조용 — 브라우저(JS) 날짜 계산. UTC 로 재야 시간대에 흔들리지 않는다. */
const oracle = (y: number, m: number, d: number) => {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // Date.UTC 는 0~99 년을 1900년대로 바꾸므로 setUTCFullYear 를 쓴다
  return t.getUTCDay();
};

describe('요일 정답 — 1600-01-01 ~ 2099-12-31 모든 날짜', () => {
  it('코드 더하기 계산이 모든 날짜에서 브라우저 날짜 계산과 같다', () => {
    let n = 0;
    const bad: string[] = [];
    for (let y = 1600; y <= 2099; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= daysInMonth(y, m); d++) {
          n++;
          if (weekday(y, m, d) !== oracle(y, m, d) && bad.length < 5) bad.push(`${y}-${m}-${d}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBe(182_622); // 1600–1999 400년(146,097일) + 2000–2099(2000년이 윤년이라 36,525일)
  });

  it('잘 알려진 날짜', () => {
    expect(weekday(2000, 1, 1)).toBe(6); // 토
    expect(weekday(1600, 1, 1)).toBe(6); // 토 (400년 주기)
    expect(weekday(1900, 1, 1)).toBe(1); // 월
    expect(weekday(1969, 7, 20)).toBe(0); // 일
    expect(weekday(2099, 12, 31)).toBe(4); // 목
    expect(weekday(2024, 2, 29)).toBe(4); // 목
  });
});

describe('코드 — 단계 입력이 쓰는 값', () => {
  it('세기 코드 6·4·2·0 되풀이', () => {
    expect([1600, 1700, 1800, 1900, 2000].map(centuryCode)).toEqual([6, 4, 2, 0, 6]);
  });
  it('윤년: 400 으로 나뉘면 윤년, 100 으로만 나뉘면 아님', () => {
    expect([1600, 1700, 1900, 2000, 2024, 2100].map(isLeap)).toEqual([true, false, false, true, true, false]);
  });
  it('윤년 1·2월만 월 코드가 하나 작다', () => {
    expect([monthCode(2023, 1), monthCode(2024, 1), monthCode(2023, 2), monthCode(2024, 2), monthCode(2024, 3)]).toEqual([0, 6, 3, 2, 3]);
  });
  it('요일 = (일 + 월 코드 + 연도 코드) mod 7, 연도 코드 = 두 자리 코드 + 세기 코드', () => {
    for (const [y, m, d] of [[1789, 7, 14], [1945, 8, 15], [2026, 9, 25]]) {
      expect(weekday(y, m, d)).toBe((d + monthCode(y, m) + yearCode(y)) % 7);
      expect(yearCode(y)).toBe((yyCode(y) + centuryCode(y)) % 7);
    }
  });
});

describe('문제 만들기', () => {
  it('같은 시드면 같은 날짜들', () => {
    const a = seeded('abc'), b = seeded('abc');
    const xs = Array.from({ length: 20 }, () => randomDate(a, 1600, 2099));
    const ys = Array.from({ length: 20 }, () => randomDate(b, 1600, 2099));
    expect(xs).toEqual(ys);
  });
  it('범위 안의 올바른 날짜만, 연도가 고르게', () => {
    const r = seeded('range');
    let leapDay = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const t = randomDate(r, 1600, 2099);
      expect(t.y >= 1600 && t.y <= 2099).toBe(true);
      expect(t.d >= 1 && t.d <= daysInMonth(t.y, t.m)).toBe(true);
      if (t.m === 2 && t.d === 29) leapDay++;
    }
    // 2월 29일은 122번(윤년 수) / 182,622일 ≈ 0.067% — 날 수로 고르면 이 비율 근처
    expect(leapDay / N).toBeGreaterThan(0.0002);
    expect(leapDay / N).toBeLessThan(0.0015);
  });
  it('좁은 범위(한 해)도 된다', () => {
    const r = seeded('one');
    for (let i = 0; i < 200; i++) expect(randomDate(r, 1987, 1987).y).toBe(1987);
  });
});

describe('요일 번호 방식', () => {
  it('일요일=0 과 월요일=1 이 서로 되돌려진다', () => {
    for (const base of ['sun0', 'mon1'] as const) {
      for (let wd = 0; wd < 7; wd++) expect(keyToWeekday(weekdayKey(wd, base), base)).toBe(wd);
      expect(weekdayOrder(base)).toHaveLength(7);
    }
    expect(weekdayKey(0, 'mon1')).toBe(7);
    expect(keyToWeekday(0, 'mon1')).toBeNull();
    expect(keyToWeekday(7, 'sun0')).toBeNull();
  });
});
