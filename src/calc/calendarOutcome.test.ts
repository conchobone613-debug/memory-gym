import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../db/sessions';
import { CAL_LEVELS, evalLevel } from './calendarLadder';
import { contestOutcome, practiceOutcome } from './calendarOutcome';

const past = (perItemMs: number, items = 20, correct = 20): SessionSummary => ({
  id: String(perItemMs), kind: 'calc', domain: 'calc', disciplineId: 'calendar', title: '달력', mode: 'practice',
  startedAt: 0, durationMs: 0, items, correct, accuracy: correct / items, perItemMs,
});
const run = (meanRtMs: number, correct = 20, items = 20) => ({ items, correct, meanRtMs, maxStreak: correct, totalMs: 90_000 });
const status = evalLevel(CAL_LEVELS[2], Array.from({ length: 12 }, () => ({ isCorrect: true, rtMs: 5000 })));

describe('달력 연습 결과', () => {
  it('첫 기록은 신기록이 아니다', () => {
    expect(practiceOutcome({ run: run(4000), status, past: [] }).record).toBeNull();
  });

  it('같은 칸 지난 판(정확도 목표를 채운 10문항 이상)보다 빠르면 신기록', () => {
    const o = practiceOutcome({ run: run(4000), status, past: [past(4200), past(3000, 20, 15), past(3500, 5, 5)] });
    // 3.0초(정확도 75%)·3.5초(5문항) 판은 기준이 아니다 → 4.2초보다 빠른 4.0초가 신기록
    expect(o.record).toEqual({ what: '평균 반응시간 4.00초' });
  });

  it('아까움은 실제 값으로: 신기록까지 0.05초, 정확도 목표까지 1문제', () => {
    expect(practiceOutcome({ run: run(4050), status, past: [past(4000)] }).near).toContainEqual({ lead: '신기록까지', value: '0.05초' });
    expect(practiceOutcome({ run: run(4000, 18), status, past: [] }).near).toContainEqual({ lead: '정확도 목표까지', value: '1문제' });
  });

  it('목표 막대는 이 칸의 사다리 기준 셋', () => {
    const o = practiceOutcome({ run: run(4000), status, past: [] });
    expect(o.goals).toBe(status.bars);
    expect(o.goals.map((g) => g.label)).toEqual(['문항 30', '정확 95%', '반응 8초']);
  });

  it('단계 입력이면 가장 느린 단계를 실제 평균으로 짚는다', () => {
    const steps = [{ name: '연도 코드', avgMs: 1840, n: 20 }, { name: '월 코드', avgMs: 420, n: 20 }, { name: '요일', avgMs: 900, n: 20 }];
    expect(practiceOutcome({ run: run(5000), status, past: [past(4000)], steps }).sage)
      .toBe('연도 코드에 평균 1.84초가 걸렸네. 연도 코드만 따로 다져 보세.');
    // 신기록이면 신기록 한마디가 먼저
    expect(practiceOutcome({ run: run(3000), status, past: [past(4000)], steps }).sage).toContain('3.00초');
  });
});

describe('달력 모의 대회 결과', () => {
  const c = (score: number, correct = score, wrong = 0) => ({ correct, wrong, score, perItemMs: 2400, limitSec: 60 });

  it('첫 기록은 신기록이 아니다', () => {
    const o = contestOutcome({ run: c(20), past: [] });
    expect(o.record).toBeNull();
    expect(o.near).toEqual([]);
    expect(o.goals).toEqual([]);
  });

  it('지난 최고보다 높으면 신기록', () => {
    const o = contestOutcome({ run: c(25), past: [22, 24] });
    expect(o.record).toEqual({ what: '점수 25점' });
    expect(o.stats[0]).toMatchObject({ label: '점수', value: '25', up: '▲3' });
    expect(o.stats.map((s) => s.value)).toEqual(['25', '25', '0', '2.40']);
  });

  it('아까움: 최고에 1점 모자랄 때만, 같거나 더 모자라면 아니다', () => {
    expect(contestOutcome({ run: c(23), past: [24] }).near).toEqual([{ lead: '신기록까지', value: '1점' }]);
    expect(contestOutcome({ run: c(24), past: [24] }).near).toEqual([]);
    expect(contestOutcome({ run: c(21), past: [24] }).near).toEqual([]);
  });

  it('스승님 한마디는 하게체, 숫자는 실제 값', () => {
    expect(contestOutcome({ run: c(25), past: [24] }).sage).toBe('25점, 지금까지 가장 높네. 이 기록은 칠판 맨 위에 적어 두겠네.');
    expect(contestOutcome({ run: c(23), past: [24] }).sage).toBe('신기록까지 1점이었네. 손이 풀린 지금 한 판 더 하게.');
    expect(contestOutcome({ run: c(18, 20, 2), past: [] }).sage).toBe('22문제 중 2문제를 틀렸네. 빠르기보다 한 문제씩 끝까지 셈해 보세.');
    expect(contestOutcome({ run: c(0, 0, 0), past: [] }).sage).toContain('60초 동안');
  });
});
