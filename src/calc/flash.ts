/*
 * 플래시 암산 — 수를 하나씩 비춘다. 한 수의 주기 = intervalMs, 앞 80% 는 수, 뒤 20% 는 빈 화면
 * (같은 자리 수가 이어져도 바뀐 줄 알게). 마지막 수 다음 빈 화면이 끝나면 끝.
 * 화면은 requestAnimationFrame 의 프레임 시각으로 매 프레임 상태를 묻고 바뀐 프레임에서만 글자를 바꾼다 —
 * 바뀌는 때가 화면 갱신 주기에 맞고, 실제로 바뀐 프레임 시각으로 간격 오차를 잰다.
 */

/** 주기 중 수를 보이는 몫 */
export const FLASH_SHOW = 0.8;

/** 표시 간격(ms) — 0.2~3.0초, 0.1초 단위, 기본 1.0초 */
export const FLASH_MS = { min: 200, max: 3000, step: 100, default: 1000 } as const;

/** 설정 칸의 초 → 범위 안 0.1초 단위 ms. 숫자가 아니면 기본값 */
export function flashMs(sec: number): number {
  if (!Number.isFinite(sec)) return FLASH_MS.default;
  return Math.min(FLASH_MS.max, Math.max(FLASH_MS.min, Math.round(sec * 10) * 100));
}

export type FlashState = { kind: 'show'; i: number } | { kind: 'blank'; i: number } | { kind: 'done' };

/** 시작부터 elapsedMs 지난 때의 화면 — i 번째 수를 보이는 중 · i 번째 뒤 빈 화면 · 끝 */
export function flashState(elapsedMs: number, count: number, intervalMs: number): FlashState {
  const t = Math.max(0, elapsedMs);
  const i = Math.floor(t / intervalMs);
  if (i >= count) return { kind: 'done' };
  return t - i * intervalMs < intervalMs * FLASH_SHOW ? { kind: 'show', i } : { kind: 'blank', i };
}

/** 화면이 바뀐 프레임 하나. 'done' 의 i 는 수 개수 */
export interface FlashChange {
  t: number;
  state: FlashState['kind'];
  i: number;
}

const key = (s: FlashState) => (s.kind === 'done' ? 'done' : `${s.kind}${s.i}`);

/**
 * rAF 고리의 시계 — frame(프레임 시각)은 상태가 바뀐 프레임에서만 새 상태를 돌려주고(그때만 글자를 바꾼다) changes 에 적는다.
 * 첫 프레임이 0초. 'done' 을 돌려준 뒤로는 언제나 null.
 */
export function flashClock(count: number, intervalMs: number) {
  let t0: number | null = null;
  let last = '';
  const changes: FlashChange[] = [];
  return {
    changes,
    frame(ts: number): FlashState | null {
      if (last === 'done') return null;
      t0 ??= ts;
      const s = flashState(ts - t0, count, intervalMs);
      if (key(s) === last) return null;
      last = key(s);
      changes.push({ t: ts, state: s.kind, i: s.kind === 'done' ? count : s.i });
      return s;
    },
  };
}

/** 0.1ms 단위(-0 은 0 으로) */
const r1 = (x: number) => Math.round(x * 10) / 10 || 0;

/**
 * 바뀐 프레임 시각들 → 수마다 실제로 보인 시간과 주기(ms, 0.1 단위). 주기 = 그 수가 처음 화면에 든 때부터 다음 수(마지막은 끝)까지.
 * 끝('done')이 없으면 마지막 수의 주기는 0 — 끝까지 비춘 판만 잰다.
 */
export function measureFlash(changes: FlashChange[]): { shownMs: number[]; periodMs: number[] } {
  const n = Math.max(0, ...changes.filter((c) => c.state !== 'done').map((c) => c.i + 1));
  const shownMs: number[] = Array(n).fill(0);
  const firstAt: (number | undefined)[] = Array(n).fill(undefined);
  changes.forEach((c, k) => {
    if (c.state === 'done') return;
    firstAt[c.i] ??= c.t;
    const next = changes[k + 1];
    if (c.state === 'show' && next) shownMs[c.i] += next.t - c.t;
  });
  const end = changes.find((c) => c.state === 'done')?.t;
  const periodMs = firstAt.map((at, i) => {
    const next = firstAt.slice(i + 1).find((x) => x !== undefined) ?? end;
    return at === undefined || next === undefined ? 0 : r1(next - at);
  });
  return { shownMs: shownMs.map(r1), periodMs };
}

/**
 * 수 count 개가 모두 한 번 이상 화면에 올랐는가. 프레임이 크게 밀리면 flashState 가 수를 건너뛰는데(보인 시간 0,
 * 끝 구간이면 개수 부족), 그 문항은 보지 못한 수까지 더한 합을 묻게 되므로 채점하지 않는다.
 */
export function flashComplete(m: { shownMs: number[] }, count: number): boolean {
  return m.shownMs.length === count && m.shownMs.every((s) => s > 0);
}

/** 설정 주기와 실제 주기의 차이 — 평균 오차(부호 있음, 실제 평균 주기 = intervalMs + meanMs)와 최대 절대 오차 */
export function flashError(periodMs: number[], intervalMs: number): { meanMs: number; maxAbsMs: number } {
  if (!periodMs.length) return { meanMs: 0, maxAbsMs: 0 };
  const errs = periodMs.map((p) => p - intervalMs);
  return { meanMs: r1(errs.reduce((a, e) => a + e, 0) / errs.length), maxAbsMs: r1(Math.max(...errs.map(Math.abs))) };
}
