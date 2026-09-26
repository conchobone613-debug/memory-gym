import { describe, expect, it } from 'vitest';
import { createReader, DIGIT_WORDS, firstErrorScore, readingMs, SPOKEN_LEAD_MS, wordsOf, type ReaderOptions } from './spoken';
import { joinCells } from './binary';

describe('firstErrorScore — 처음 틀린 곳까지 맞힌 자리 수', () => {
  it('전부 맞으면 전체 길이', () => {
    expect(firstErrorScore('0123456789', '0123456789')).toBe(10);
    expect(firstErrorScore('0123', '0123999')).toBe(4); // 출제보다 긴 답은 보지 않는다
  });

  it('처음 틀린 자리 앞까지만 센다', () => {
    expect(firstErrorScore('0123456789', '0124456789')).toBe(3);
    expect(firstErrorScore('0123456789', '9123456789')).toBe(0);
  });

  it('빈 자리·모자란 길이는 틀림', () => {
    expect(firstErrorScore('0123456789', '01 3456789')).toBe(2);
    expect(firstErrorScore('0123456789', '012')).toBe(3);
    expect(firstErrorScore('0123456789', '')).toBe(0);
  });

  it('칸 답을 칸 길이로 이어 붙여 채점한다', () => {
    expect(firstErrorScore('012345', joinCells(['01', '2', '45'], 2))).toBe(3);
  });
});

describe('낱말과 낭독 시간', () => {
  it('숫자를 언어별 낱말로', () => {
    expect(wordsOf(['3', '0', '9'], 'ko')).toEqual(['삼', '공', '구']);
    expect(wordsOf(['3', '0', '9'], 'en')).toEqual(['three', 'zero', 'nine']);
    expect(DIGIT_WORDS.ko).toHaveLength(10);
    expect(DIGIT_WORDS.en).toHaveLength(10);
  });

  it('낭독 시간 = 앞 여유 + 개수 × 간격', () => {
    expect(readingMs(100, 1000)).toBe(SPOKEN_LEAD_MS + 100_000);
    expect(readingMs(10, 1500, 0)).toBe(15_000);
  });
});

/** 가짜 시계 — 예약한 시각 순서대로 깨운다. late(at) 만큼 늦게 깨어나게 할 수 있다. */
function fakeClock(start = 0) {
  let t = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { timers.set(++seq, { at: t + ms, fn }); return seq; },
    clearTimer: (id: unknown) => { timers.delete(id as number); },
    pending: () => timers.size,
    runUntil(to: number, late: (at: number) => number = () => 0) {
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > to) { t = Math.max(t, to); return; }
        timers.delete(next[0]);
        t = next[1].at + late(next[1].at);
        next[1].fn();
      }
    },
  };
}

function setup(words: string[], clock = fakeClock(), extra: Partial<ReaderOptions> = {}) {
  const said: [string, number, number][] = [];
  const ticks: number[] = [];
  const ends: number[] = [];
  const reader = createReader({
    words, intervalMs: 1000, leadMs: 800,
    speak: (w, i) => said.push([w, i, clock.now()]),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onTick: (i) => ticks.push(i),
    onEnd: () => ends.push(clock.now()),
    ...extra,
  });
  return { reader, clock, said, ticks, ends };
}

describe('createReader — 낭독 박자', () => {
  it('i번째 낱말은 시작 + 앞 여유 + i × 간격에, 끝은 마지막 낱말 한 간격 뒤에 1회', () => {
    const { reader, clock, said, ticks, ends } = setup(['일', '이', '삼'], fakeClock(5000));
    reader.start();
    clock.runUntil(100_000);
    expect(said).toEqual([['일', 0, 5800], ['이', 1, 6800], ['삼', 2, 7800]]);
    expect(ticks).toEqual([0, 1, 2]);
    expect(ends).toEqual([8800]);
    expect(clock.pending()).toBe(0);
  });

  it('늦게 깨어나도 다음 박자는 제시각 — 오차가 쌓이지 않는다', () => {
    const { reader, clock, said, ends } = setup(['일', '이', '삼']);
    reader.start();
    clock.runUntil(100_000, (at) => (at === 800 ? 300 : at === 1800 ? 120 : 0));
    expect(said.map((s) => s[2])).toEqual([1100, 1920, 2800]);
    expect(ends).toEqual([3800]);
  });

  it('멈춘 뒤에는 아무것도 부르지 않는다', () => {
    const { reader, clock, said, ends } = setup(['일', '이', '삼']);
    reader.start();
    clock.runUntil(1000);
    reader.stop();
    clock.runUntil(100_000);
    expect(said).toHaveLength(1);
    expect(ends).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('박자 알림 안에서 멈춰도, 시작 전에 멈춰도 뒤가 없다', () => {
    const clock = fakeClock();
    let reader: { stop(): void } | null = null;
    const a = setup(['일', '이'], clock, { onTick: () => reader?.stop() });
    reader = a.reader;
    a.reader.start();
    clock.runUntil(100_000);
    expect(a.said).toHaveLength(1);
    expect(a.ends).toEqual([]);

    const b = setup(['일'], fakeClock());
    b.reader.stop();
    b.reader.start();
    b.clock.runUntil(100_000);
    expect(b.said).toEqual([]);
    expect(b.ends).toEqual([]);
  });

  it('두 번 시작해도 한 번만 읽는다 · 낱말이 없으면 앞 여유 뒤 바로 끝', () => {
    const a = setup(['일']);
    a.reader.start();
    a.reader.start();
    a.clock.runUntil(100_000);
    expect(a.said).toHaveLength(1);
    expect(a.ends).toHaveLength(1);

    const b = setup([]);
    b.reader.start();
    b.clock.runUntil(100_000);
    expect(b.ends).toEqual([800]);
  });

  it('목소리 쪽이 실패해도 박자는 이어 간다', () => {
    const clock = fakeClock();
    const { reader, ticks, ends } = setup(['일', '이'], clock, { speak: () => { throw new Error('음성 없음'); } });
    reader.start();
    clock.runUntil(100_000);
    expect(ticks).toEqual([0, 1]);
    expect(ends).toEqual([2800]);
  });
});
