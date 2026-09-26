import { describe, expect, it } from 'vitest';
import {
  agoText, BAR_GAP, dayReadout, fmtMin, labelEvery, MIN_SEG, nearestIndex, niceScale, shortDay, slotAt, sparkPoints, stackPx,
} from './chart';

describe('niceScale — 분 축 눈금', () => {
  it('끝이 가장 큰 값을 덮고, 0 부터 같은 간격', () => {
    for (const max of [0.4, 1, 2.5, 7, 12.3, 25, 37.5, 59.9, 100, 240]) {
      const { top, ticks } = niceScale(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(top);
      const step = ticks[1] - ticks[0];
      ticks.forEach((t, i) => expect(t).toBeCloseTo(i * step, 6));
      expect(ticks.length).toBeLessThanOrEqual(5);
    }
  });

  it('간격은 1·2·5 × 10^k', () => {
    expect(niceScale(37.5)).toEqual({ top: 40, ticks: [0, 20, 40] });
    expect(niceScale(25)).toEqual({ top: 30, ticks: [0, 10, 20, 30] });
    expect(niceScale(100)).toEqual({ top: 100, ticks: [0, 50, 100] });
  });

  it('작은 값·빈 기간도 간격은 1분 아래로 내려가지 않는다', () => {
    expect(niceScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceScale(0.4)).toEqual({ top: 1, ticks: [0, 1] });
    expect(niceScale(2.5)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
  });
});

describe('stackPx — 쌓은 막대 두 조각', () => {
  it('두 조각이 다 있으면 2px 틈을 위 조각에서 떼어 전체 높이가 눈금과 맞는다', () => {
    const s = stackPx(20, 10, 40, 120);
    expect(s.gap).toBe(BAR_GAP);
    expect(s.memory).toBe(60);
    expect(s.memory + s.gap + s.calc).toBeCloseTo(90, 6);
  });

  it('한쪽이 0 이면 틈도 없고 그 조각은 0', () => {
    expect(stackPx(12, 0, 40, 120)).toEqual({ memory: 36, calc: 0, gap: 0 });
    expect(stackPx(0, 8, 40, 120)).toEqual({ memory: 0, calc: 24, gap: 0 });
    expect(stackPx(0, 0, 40, 120)).toEqual({ memory: 0, calc: 0, gap: 0 });
  });

  it('아주 작은 값도 0 이 아니면 보이게 2px 이상', () => {
    const s = stackPx(0.1, 0.1, 60, 120);
    expect(s.memory).toBeGreaterThanOrEqual(MIN_SEG);
    expect(s.calc).toBeGreaterThanOrEqual(MIN_SEG);
  });
});

describe('slotAt · nearestIndex — 누른 곳에서 칸 고르기', () => {
  it('칸 전체가 누름 영역이고 끝은 붙잡는다', () => {
    expect(slotAt(0, 300, 30)).toBe(0);
    expect(slotAt(9.9, 300, 30)).toBe(0);
    expect(slotAt(10, 300, 30)).toBe(1);
    expect(slotAt(299, 300, 30)).toBe(29);
    expect(slotAt(-5, 300, 30)).toBe(0);
    expect(slotAt(400, 300, 30)).toBe(29);
  });

  it('가장 가까운 점', () => {
    const xs = [0, 50, 100, 150];
    expect(nearestIndex(xs, -10)).toBe(0);
    expect(nearestIndex(xs, 74)).toBe(1);
    expect(nearestIndex(xs, 76)).toBe(2);
    expect(nearestIndex(xs, 999)).toBe(3);
    expect(nearestIndex([42], 0)).toBe(0);
  });
});

describe('sparkPoints — 추세선 좌표', () => {
  const box = { x0: 30, x1: 250, y0: 10, y1: 42 };

  it('오래된 값이 왼쪽, 큰 값이 위(y 가 작다), 양 끝은 상자 끝', () => {
    const p = sparkPoints([80, 100, 90], box);
    expect(p.map((q) => q.x)).toEqual([30, 140, 250]);
    expect(p[1].y).toBe(10);
    expect(p[0].y).toBe(42);
    expect(p[2].y).toBe(26);
  });

  it('값이 모두 같으면 가운데 한 줄', () => {
    expect(sparkPoints([5, 5, 5], box).every((q) => q.y === 26)).toBe(true);
  });

  it('값이 하나면 오른쪽 끝에 점 하나', () => {
    expect(sparkPoints([96], box)).toEqual([{ x: 250, y: 26 }]);
  });
});

describe('글자 모양', () => {
  it('날짜·분·며칠 전', () => {
    expect(shortDay('2026-09-26')).toBe('9/26');
    expect(shortDay('2026-01-05')).toBe('1/5');
    expect(fmtMin(12)).toBe('12분');
    expect(fmtMin(8.5)).toBe('8.5분');
    expect(fmtMin(0)).toBe('0분');
    expect(agoText(0)).toBe('오늘');
    expect(agoText(1)).toBe('어제');
    expect(agoText(9)).toBe('9일 전');
  });

  it('그 날 값 한 줄', () => {
    expect(dayReadout({ day: '2026-09-26', memoryMin: 12, calcMin: 8 })).toBe('9/26 · 기억력 12분 · 계산 8분');
  });

  it('날짜 글자 거르기 — 7일 매일, 14일 이틀, 30일 닷새', () => {
    expect([7, 14, 30].map(labelEvery)).toEqual([1, 2, 5]);
  });
});
