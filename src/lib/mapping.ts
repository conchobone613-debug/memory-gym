import type { ChosungMap } from './hangul';
import { randBelow } from './random';

/** 초급 단계: 1 = 자음 하나, 2 = 자음 두 개 */
export type Stage = 1 | 2;

/**
 * 방향이 두 개인 이유.
 * - 숫자 → 자음: 외울 때 쓰는 머리 (숫자를 보고 이미지를 만든다). 기본값.
 * - 자음 → 숫자: 떠올릴 때 되짚는 길 (이미지에서 숫자를 꺼낸다)
 * 둘은 따로 는다. 다만 숫자를 외우는 것이 목적이므로 숫자 → 자음이 먼저다.
 */
export type Direction = 'toConsonant' | 'toDigit';

export interface Question {
  /** 통계를 쌓는 단위. 1단계는 '7', 2단계는 '47' */
  unit: string;
  stage: Stage;
  direction: Direction;
  /** 화면에 띄울 문제 */
  prompt: string;
  /** 정답 표기 */
  answer: string;
  /**
   * 자음으로 답할 때 각 자리에 허용되는 묶음. 1 이면 ㄱ·ㅋ·ㄲ 아무거나 맞다.
   * 보기에서 고르게 하지 않는 이유: 한글 자판은 자음이 물리 키에 그대로 있어 바로 칠 수 있고,
   * 고르는 것(재인)보다 떠올려 치는 것(회상)이 훨씬 강하게 붙는다.
   */
  groups?: string[];
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const groupOf = (d: string, map: ChosungMap) => map[d] ?? '?';
const letterOf = (d: string, map: ChosungMap) => {
  const g = groupOf(d, map);
  return g.length ? g[randBelow(g.length)] : '?';
};

export function makeQuestion(stage: Stage, unit: string, map: ChosungMap, direction?: Direction): Question {
  const dir: Direction = direction ?? (randBelow(2) === 0 ? 'toConsonant' : 'toDigit');
  const digits = unit.split('');

  if (dir === 'toConsonant') {
    return {
      unit, stage, direction: dir,
      prompt: unit,
      answer: digits.map((d) => groupOf(d, map)).join(' · '),
      groups: digits.map((d) => groupOf(d, map)),
    };
  }
  return {
    unit, stage, direction: dir,
    prompt: digits.map((d) => letterOf(d, map)).join(' '),
    answer: unit,
  };
}

/** 단계별 전체 단위 목록. 1단계는 0~9, 2단계는 00~99. */
export function allUnits(stage: Stage): string[] {
  return stage === 1 ? DIGITS : Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
}

export const statKey = (stage: Stage, unit: string) => `s${stage}:${unit}`;
