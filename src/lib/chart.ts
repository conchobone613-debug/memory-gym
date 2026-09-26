import type { DayMinutes } from '../db/insights';

/*
 * 기록 탭 그래프의 셈 — 눈금 · 쌓은 막대 조각 · 추세선 좌표 · 누른 곳에서 가장 가까운 칸.
 * 화면(components/InsightCharts)은 그리기만 한다.
 */

/** 계열 색 — 막대·선·색 점에만. 글자는 ink/ink-2 */
export const SERIES_COLOR = { memory: 'var(--chart-memory)', calc: 'var(--chart-calc)' } as const;

/** '2026-09-26' → '9/26' */
export const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** 분 — 소수 한 자리까지(12 → '12분', 8.5 → '8.5분') */
export const fmtMin = (m: number) => `${Math.round(m * 10) / 10}분`;

/** 며칠 전 → '오늘' · '어제' · 'N일 전' */
export const agoText = (n: number) => (n <= 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`);

/** 그 날 값 한 줄 — 풍선·읽어 주기에 같은 글 */
export const dayReadout = (d: DayMinutes) => `${shortDay(d.day)} · 기억력 ${fmtMin(d.memoryMin)} · 계산 ${fmtMin(d.calcMin)}`;

/** 날짜 글자를 며칠 걸러 적을지 — 휴대폰 폭에 겹치지 않게(7일 = 매일, 14일 = 이틀, 30일 = 닷새) */
export const labelEvery = (days: number) => Math.max(1, Math.ceil(days / 7));

/** 눈금 — 0 부터 1·2·5×10^k 간격으로, 가장 큰 값을 덮는 가장 작은 끝. 간격은 minStep 보다 작지 않게(분 축은 1분) */
export function niceScale(max: number, count = 3, minStep = 1): { top: number; ticks: number[] } {
  const raw = Math.max(0, max) / count;
  let step = minStep;
  if (raw > minStep) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-9)!;
  }
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + 1e-9; i++) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return { top, ticks };
}

export const BAR_GAP = 2;
export const MIN_SEG = 2;

/**
 * 쌓은 막대 한 칸의 두 조각 높이(px) — 아래 기억력, 위 계산. 0 이 아닌 조각은 적어도 2px(보이게).
 * 두 조각 사이 2px 바탕색 틈은 위 조각에서 떼어 막대 전체 높이가 눈금과 맞게 한다.
 */
export function stackPx(memory: number, calc: number, top: number, plotH: number): { memory: number; calc: number; gap: number } {
  const px = (v: number) => (v > 0 && top > 0 ? Math.max(MIN_SEG, (v / top) * plotH) : 0);
  const m = px(memory);
  const c = px(calc);
  const gap = m > 0 && c > 0 ? BAR_GAP : 0;
  return { memory: m, calc: gap ? Math.max(MIN_SEG, c - gap) : c, gap };
}

/** 가로 위치 → 막대 칸 번호. 칸 전체(막대 옆 틈 포함)가 누름 영역이다 */
export const slotAt = (x: number, width: number, n: number) =>
  Math.min(n - 1, Math.max(0, Math.floor((x / Math.max(1, width)) * n)));

/** 가로 위치에서 가장 가까운 점의 번호 */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

/**
 * 추세선 좌표 — 오래된 값이 왼쪽. 세로는 값의 최소(아래 y1) ~ 최대(위 y0), 모두 같으면 가운데.
 * 값이 하나면 오른쪽 끝에 점 하나.
 */
export function sparkPoints(values: number[], box: { x0: number; x1: number; y0: number; y1: number }): { x: number; y: number }[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? box.x1 : box.x0 + ((box.x1 - box.x0) * i) / (n - 1),
    y: hi === lo ? (box.y0 + box.y1) / 2 : box.y1 - ((v - lo) / (hi - lo)) * (box.y1 - box.y0),
  }));
}
