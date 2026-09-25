import type { PracticeMode } from '../db/db';

/*
 * 기억력 종목 프리셋 — 종목 화면(Practice)과 스승님의 예상 시간(coach/catalog)이 같은 값을 본다.
 * 종목 등록부(events.ts)의 to 가 ?preset=<id> 로 여기를 가리킨다.
 */

export interface Preset {
  id: string; label: string; mode: PracticeMode; length: number; memorizeSec: number; recallSec: number; chunk: number;
}

export const PRESETS: Preset[] = [
  { id: 'd80', label: '숫자 80자리 (5분 / 15분)', mode: 'digits', length: 80, memorizeSec: 300, recallSec: 900, chunk: 2 },
  { id: 'd40', label: '숫자 40자리 (2분 / 5분)', mode: 'digits', length: 40, memorizeSec: 120, recallSec: 300, chunk: 2 },
  { id: 'c52', label: '카드 52장 (5분 / 5분)', mode: 'cards', length: 52, memorizeSec: 300, recallSec: 300, chunk: 1 },
  { id: 'c20', label: '카드 20장 (2분 / 3분)', mode: 'cards', length: 20, memorizeSec: 120, recallSec: 180, chunk: 1 },
  /* 대회 지구력 종목. 대회는 '시간 안에 최대한 많이' 지만 여기서는 길이를 넉넉히 잡아 흉내만 낸다. */
  { id: 'h-num', label: '1시간 숫자 600자리 (60분 / 120분)', mode: 'digits', length: 600, memorizeSec: 3600, recallSec: 7200, chunk: 2 },
];
