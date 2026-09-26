/*
 * 듣고 외우는 숫자 — 채점과 낭독 박자. 브라우저 음성은 lib/speech.ts 가 맡고, 여기는 시계를 받아 쓰는 순수 로직이다.
 */

export type SpokenLang = 'ko' | 'en';
export const DEFAULT_SPOKEN_LANG: SpokenLang = 'ko';

/** 숫자 글자를 그대로 넘기면 기기마다 읽는 법이 달라 낱말로 넘긴다. */
export const DIGIT_WORDS: Record<SpokenLang, string[]> = {
  ko: ['공', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'],
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
};

/** 첫 낱말 앞 여유 — 시작을 누르고 귀를 기울일 틈 */
export const SPOKEN_LEAD_MS = 800;

/** 숫자 목록('3','0',…) → 읽을 낱말 목록 */
export const wordsOf = (digits: readonly string[], lang: SpokenLang): string[] =>
  digits.map((d) => DIGIT_WORDS[lang][Number(d)] ?? d);

/** 시작부터 끝(onEnd)까지 걸리는 시간 = 앞 여유 + 낱말 수 × 간격 */
export const readingMs = (count: number, intervalMs: number, leadMs = SPOKEN_LEAD_MS) => leadMs + count * intervalMs;

/** 대회 점수 — 처음부터 연속으로 맞힌 자리 수. 빈 자리(' ')·모자란 길이는 틀림. */
export function firstErrorScore(expected: string, answered: string): number {
  let i = 0;
  while (i < expected.length && answered[i] !== ' ' && answered[i] === expected[i]) i++;
  return i;
}

export interface ReaderOptions {
  words: string[];
  intervalMs: number;
  leadMs: number;
  speak(word: string, i: number): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  onTick?(i: number): void;
  onEnd(): void;
}

/**
 * 낭독기. i번째 낱말은 t0 + leadMs + i*intervalMs 에 말한다 — 매번 now() 로 남은 시간을 다시 재서
 * 누적 오차가 없고, 늦게 깨어나도 다음 박자는 제시각이다. 마지막 낱말 뒤 intervalMs 가 지나면 onEnd 1회.
 * 발화 끝 이벤트를 기다리지 않는다 — 목소리가 없거나 늦는 기기에서도 박자가 유지돼야 한다.
 */
export function createReader(o: ReaderOptions): { start(): void; stop(): void } {
  let t0 = 0;
  let i = 0;
  let timer: unknown = null;
  let started = false;
  let stopped = false;

  const due = (k: number) => t0 + o.leadMs + k * o.intervalMs;
  const schedule = () => { timer = o.setTimer(fire, Math.max(0, due(i) - o.now())); };
  const fire = () => {
    timer = null;
    if (stopped) return;
    if (i >= o.words.length) {
      stopped = true;
      o.onEnd();
      return;
    }
    /* 음성 쪽이 실패해도 박자는 이어 간다 */
    try { o.speak(o.words[i], i); } catch { /* 소리 없이 진행 */ }
    o.onTick?.(i);
    i++;
    if (!stopped) schedule();
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      t0 = o.now();
      schedule();
    },
    stop() {
      stopped = true;
      if (timer != null) o.clearTimer(timer);
      timer = null;
    },
  };
}
