import { describe, expect, it } from 'vitest';
import { centuryCode, monthCode, weekday, yearCode } from './calendar';
import { contestScore, explain, fmtPrompt, makeItem, stepAverages } from './calendarDrill';
import { seeded } from './rng';

const P = { yearFrom: 1600, yearTo: 2099 };

describe('달력 문제', () => {
  it('연도 드릴: 정답 = 연도 코드', () => {
    const r = seeded('y');
    for (let i = 0; i < 500; i++) {
      const it = makeItem('year', P, r);
      expect(it.expected).toBe(yearCode(Number(it.prompt)));
      expect(Number(it.prompt)).toBeGreaterThanOrEqual(1600);
      expect(Number(it.prompt)).toBeLessThanOrEqual(2099);
    }
  });

  it('코드 드릴: 월(윤년 포함)·세기 코드가 모두 나오고 정답이 맞다', () => {
    const r = seeded('c');
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const it = makeItem('code', P, r);
      seen.add(`${it.prompt}${it.note ?? ''}`);
      if (it.kind === 'month') {
        const m = parseInt(it.prompt, 10);
        expect(it.expected).toBe(monthCode(it.note ? 2024 : 2023, m));
      } else {
        expect(it.kind).toBe('century');
        expect(it.expected).toBe(centuryCode(parseInt(it.prompt, 10)));
      }
    }
    expect(seen.size).toBe(19); // 월 12 + 윤년 1·2월 2 + 세기 5
  });

  it('전체 계산: 정답 = 요일, 단계 입력이면 세 단계 정답이 코드와 맞다', () => {
    const r = seeded('f');
    for (let i = 0; i < 1000; i++) {
      const it = makeItem('full', { ...P, steps: true }, r);
      const { y, m, d } = it.date!;
      expect(it.expected).toBe(weekday(y, m, d));
      expect(it.steps!.map((s) => s.expected)).toEqual([yearCode(y), monthCode(y, m), weekday(y, m, d)]);
      expect(it.prompt).toBe(fmtPrompt(it.date!));
    }
    expect(makeItem('full', P, seeded('x')).steps).toBeUndefined();
  });

  it('문제 카드 글자는 자릿수가 일정하다', () => {
    expect(fmtPrompt({ y: 1987, m: 3, d: 4 })).toBe('1987.03.04');
    expect(fmtPrompt({ y: 2024, m: 12, d: 31 })).toHaveLength(10);
  });

  it('풀이는 실제 계산을 적는다', () => {
    const it = makeItem('full', { yearFrom: 2000, yearTo: 2000 }, seeded('e'));
    expect(explain(it)).toContain(`나머지 ${it.expected}`);
    expect(explain({ kind: 'year', prompt: '1987', expected: yearCode(1987) })).toBe(`87 + 21 + 세기 0 = 108 → 7로 나눈 나머지 ${yearCode(1987)}`);
  });
});

describe('점수와 느린 단계', () => {
  it('모의 대회 점수는 감점을 빼되 0 아래로 가지 않는다', () => {
    expect(contestScore(30, 2, 0)).toBe(30);
    expect(contestScore(30, 2, 1)).toBe(28);
    expect(contestScore(1, 5, 1)).toBe(0);
  });
  it('단계별 평균 시간', () => {
    const avg = stepAverages([
      { steps: [{ name: '연도 코드', ms: 1800 }, { name: '월 코드', ms: 400 }, { name: '요일', ms: 900 }] },
      { steps: [{ name: '연도 코드', ms: 2200 }, { name: '월 코드', ms: 0 }, { name: '요일', ms: 700 }] },
      {},
    ]);
    expect(avg).toEqual([
      { name: '연도 코드', avgMs: 2000, n: 2 },
      { name: '월 코드', avgMs: 400, n: 1 },
      { name: '요일', avgMs: 800, n: 2 },
    ]);
  });
});
