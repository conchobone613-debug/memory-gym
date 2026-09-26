import { describe, expect, it } from 'vitest';
import {
  FLASH_MS, flashClock, flashComplete, flashError, flashMs, flashState, measureFlash, type FlashChange,
} from './flash';
import { seeded } from './rng';

/** 가짜 프레임 시계로 플래시 한 번을 끝까지 흘린다 — 프레임 간격 dt() 를 차례로, 시작 시각 start */
function runClock(count: number, intervalMs: number, dt: () => number, start = 12_345.6) {
  const clock = flashClock(count, intervalMs);
  let t = start;
  let returnedDone = 0;
  let maxDt = 0;
  for (let k = 0; k < 1_000_000; k++) {
    const s = clock.frame(t);
    if (s?.kind === 'done') returnedDone++;
    if (returnedDone && clock.frame(t + 1000) === null) break;
    const d = dt();
    maxDt = Math.max(maxDt, d);
    t += d;
  }
  return { changes: clock.changes, returnedDone, maxDt };
}

const hz = (f: number) => () => 1000 / f;

describe('플래시 상태(flashState)', () => {
  it('주기의 앞 80% 는 수, 뒤 20% 는 빈 화면, 마지막 빈 화면이 끝나면 끝', () => {
    expect(flashState(0, 3, 1000)).toEqual({ kind: 'show', i: 0 });
    expect(flashState(799.9, 3, 1000)).toEqual({ kind: 'show', i: 0 });
    expect(flashState(800, 3, 1000)).toEqual({ kind: 'blank', i: 0 });
    expect(flashState(999.9, 3, 1000)).toEqual({ kind: 'blank', i: 0 });
    expect(flashState(1000, 3, 1000)).toEqual({ kind: 'show', i: 1 });
    expect(flashState(2800, 3, 1000)).toEqual({ kind: 'blank', i: 2 });
    expect(flashState(3000, 3, 1000)).toEqual({ kind: 'done' });
    expect(flashState(-5, 3, 1000)).toEqual({ kind: 'show', i: 0 });
    expect(flashState(159, 5, 200)).toEqual({ kind: 'show', i: 0 });
    expect(flashState(160, 5, 200)).toEqual({ kind: 'blank', i: 0 });
  });

  it('표시 간격은 0.2~3.0초, 0.1초 단위', () => {
    expect(flashMs(1)).toBe(1000);
    expect(flashMs(0.25)).toBe(300);
    expect(flashMs(0.1)).toBe(FLASH_MS.min);
    expect(flashMs(9)).toBe(FLASH_MS.max);
    expect(flashMs(Number.NaN)).toBe(FLASH_MS.default);
    expect(flashMs(1.2345)).toBe(1200);
  });
});

describe('프레임 시계로 잰 플래시', () => {
  const clocks: [string, () => () => number][] = [
    ['60Hz', () => hz(60)],
    ['144Hz', () => hz(144)],
    ['55~65Hz 흔들림', () => { const r = seeded('jitter'); return () => 1000 / (55 + r() * 10); }],
  ];
  const intervals = [200, 300, 700, 1000, 1500, 3000];

  for (const [name, make] of clocks) {
    it(`${name} — 주기 오차 한 프레임 이내 · 순서가 빠지거나 겹치지 않음 · 보인 시간 ≈ 80% · 끝이 한 번`, () => {
      for (const intervalMs of intervals) {
        const count = 12;
        const { changes, returnedDone, maxDt } = runClock(count, intervalMs, make());
        const tag = `${name} ${intervalMs}ms`;
        /* show 0 · blank 0 · show 1 · … · blank 11 · done — 빠진 수도 겹친 수도 없다 */
        const expected = [...Array.from({ length: count }, (_, i) => [`show${i}`, `blank${i}`]).flat(), 'done'];
        expect(changes.map((c) => (c.state === 'done' ? 'done' : `${c.state}${c.i}`)), tag).toEqual(expected);
        expect(returnedDone, tag).toBe(1);
        expect(changes.filter((c) => c.state === 'done'), tag).toHaveLength(1);

        const { shownMs, periodMs } = measureFlash(changes);
        expect(periodMs, tag).toHaveLength(count);
        for (const p of periodMs) expect(Math.abs(p - intervalMs), tag).toBeLessThanOrEqual(maxDt + 0.1);
        for (const s of shownMs) expect(Math.abs(s - intervalMs * 0.8), tag).toBeLessThanOrEqual(maxDt + 0.1);
        const err = flashError(periodMs, intervalMs);
        expect(err.maxAbsMs, tag).toBeLessThanOrEqual(maxDt + 0.1);
        expect(Math.abs(err.meanMs), tag).toBeLessThanOrEqual(maxDt + 0.1);
      }
    });
  }

  it('끝난 뒤로는 어떤 프레임에도 상태를 돌려주지 않는다', () => {
    const c = flashClock(2, 200);
    expect(c.frame(0)).toEqual({ kind: 'show', i: 0 });
    expect(c.frame(10)).toBeNull();
    expect(c.frame(170)).toEqual({ kind: 'blank', i: 0 });
    expect(c.frame(500)).toEqual({ kind: 'done' });
    expect(c.frame(510)).toBeNull();
    expect(c.frame(99_999)).toBeNull();
    expect(c.changes.at(-1)).toEqual({ t: 500, state: 'done', i: 2 });
  });
});

describe('보인 시간·주기 재기(measureFlash) · 오차(flashError)', () => {
  it('바뀐 프레임 시각에서 수마다', () => {
    const changes: FlashChange[] = [
      { t: 100, state: 'show', i: 0 }, { t: 900, state: 'blank', i: 0 },
      { t: 1116.7, state: 'show', i: 1 }, { t: 1916.7, state: 'blank', i: 1 },
      { t: 2100, state: 'done', i: 2 },
    ];
    expect(measureFlash(changes)).toEqual({ shownMs: [800, 800], periodMs: [1016.7, 983.3] });
    expect(flashError([1016.7, 983.3], 1000)).toEqual({ meanMs: 0, maxAbsMs: 16.7 });
    expect(flashError([1010, 1020], 1000)).toEqual({ meanMs: 15, maxAbsMs: 20 });
    expect(flashError([], 1000)).toEqual({ meanMs: 0, maxAbsMs: 0 });
  });

  it('프레임이 밀려 수를 못 보인 채 빈 화면이 되면 보인 시간 0, 끝이 없으면 마지막 주기 0', () => {
    const changes: FlashChange[] = [
      { t: 0, state: 'show', i: 0 }, { t: 850, state: 'blank', i: 1 }, { t: 1000, state: 'show', i: 2 },
    ];
    expect(measureFlash(changes)).toEqual({ shownMs: [850, 0, 0], periodMs: [850, 150, 0] });
  });
});

describe('수를 모두 비췄는가(flashComplete)', () => {
  /** 프레임 시각 목록을 시계에 차례로 넘겨 끝까지 흘린다 */
  const feed = (count: number, intervalMs: number, times: number[]) => {
    const clock = flashClock(count, intervalMs);
    for (const t of times) clock.frame(t);
    return clock.changes;
  };
  /** from 부터 to 전까지 60Hz 프레임 시각 */
  const at60 = (from: number, to: number) => {
    const out: number[] = [];
    for (let t = from; t < to; t += 1000 / 60) out.push(Math.round(t * 10) / 10);
    return out;
  };

  it('60Hz 로 끝까지 흘리면 모두 비췄다', () => {
    const m = measureFlash(feed(5, 200, at60(0, 1100)));
    expect(m.shownMs).toHaveLength(5);
    expect(flashComplete(m, 5)).toBe(true);
  });

  it('간격 0.2초에서 한 번 180ms 멈추면 수 하나를 건너뛴다 — 모두 비추지 못했다', () => {
    /* blank0(166.7) 다음 프레임이 363.3 — show1(200~360)을 한 번도 그리지 못하고 blank1 로 */
    const changes = feed(5, 200, [...at60(0, 170), ...at60(363.3, 1100)]);
    expect(changes.slice(0, 3).map((c) => `${c.state}${c.i}`)).toEqual(['show0', 'blank0', 'blank1']);
    const m = measureFlash(changes);
    expect(m.shownMs[1]).toBe(0);
    expect(changes.at(-1)?.state).toBe('done');
    expect(flashComplete(m, 5)).toBe(false);
  });

  it('끝 구간을 덮는 멈춤으로 마지막 수들이 빠진 채 끝나면 모두 비추지 못했다', () => {
    /* show3(600~760) 중에 멈춰 1013 에 바로 끝 — show4 는 오르지 못했다 */
    const changes = feed(5, 200, [...at60(0, 650), 1013.3]);
    expect(changes.at(-1)?.state).toBe('done');
    const m = measureFlash(changes);
    expect(m.shownMs).toHaveLength(4);
    expect(flashComplete(m, 5)).toBe(false);
  });

  it('보인 시간이 모두 0 보다 크고 개수가 맞아야 한다', () => {
    expect(flashComplete({ shownMs: [160, 150, 170] }, 3)).toBe(true);
    expect(flashComplete({ shownMs: [160, 0, 170] }, 3)).toBe(false);
    expect(flashComplete({ shownMs: [160, 150] }, 3)).toBe(false);
    expect(flashComplete({ shownMs: [] }, 0)).toBe(true);
  });
});
