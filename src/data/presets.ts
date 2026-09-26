import type { PracticeMode } from '../db/db';

/*
 * 기억력 종목 프리셋 — 종목 화면(Practice)과 스승님의 예상 시간(coach/catalog)이 같은 값을 본다.
 * 종목 등록부(events.ts)의 to 가 ?preset=<id> 로 여기를 가리킨다.
 */

export interface Preset {
  id: string; label: string; mode: PracticeMode; length: number; memorizeSec: number; recallSec: number; chunk: number;
  /** 이 프리셋이 속한 종목(events.ts 의 id) */
  eventId: string;
  /** 듣기 종목 — 낭독 간격. memorizeSec 은 낭독 시간(스승님 예상 시간이 쓴다) */
  spoken?: { intervalMs: number };
}

export const PRESETS: Preset[] = [
  { id: 'd80', label: '숫자 80자리 (5분 / 15분)', mode: 'digits', length: 80, memorizeSec: 300, recallSec: 900, chunk: 2, eventId: 'speed-numbers' },
  { id: 'd40', label: '숫자 40자리 (2분 / 5분)', mode: 'digits', length: 40, memorizeSec: 120, recallSec: 300, chunk: 2, eventId: 'speed-numbers' },
  { id: 'c52', label: '카드 52장 (5분 / 5분)', mode: 'cards', length: 52, memorizeSec: 300, recallSec: 300, chunk: 1, eventId: 'speed-cards' },
  { id: 'c20', label: '카드 20장 (2분 / 3분)', mode: 'cards', length: 20, memorizeSec: 120, recallSec: 180, chunk: 1, eventId: 'speed-cards' },
  /* 대회 지구력 종목. 대회는 '시간 안에 최대한 많이' 지만 여기서는 길이를 넉넉히 잡아 흉내만 낸다. */
  { id: 'h-num', label: '1시간 숫자 600자리 (60분 / 120분)', mode: 'digits', length: 600, memorizeSec: 3600, recallSec: 7200, chunk: 2, eventId: 'hour-numbers' },
  {
    id: 'sp100', label: '듣고 외우는 숫자 100자리 (초당 1개 / 회상 5분)', mode: 'digits', length: 100, memorizeSec: 100, recallSec: 300,
    chunk: 2, eventId: 'spoken-numbers', spoken: { intervalMs: 1000 },
  },
  {
    id: 'sp50', label: '듣고 외우는 숫자 50자리 (초당 1개 / 회상 3분)', mode: 'digits', length: 50, memorizeSec: 50, recallSec: 180,
    chunk: 2, eventId: 'spoken-numbers', spoken: { intervalMs: 1000 },
  },
  /* 240자리 = 이미지 40개 = 스피드 숫자 80자리와 같은 이미지 수 */
  { id: 'b5', label: '이진수 240자리 (5분 / 15분)', mode: 'binary', length: 240, memorizeSec: 300, recallSec: 900, chunk: 6, eventId: 'binary' },
  { id: 'b2', label: '이진수 120자리 (2분 / 5분)', mode: 'binary', length: 120, memorizeSec: 120, recallSec: 300, chunk: 6, eventId: 'binary' },
];
