import type { ChosungMap } from './hangul';
import { randBelow, sample, shuffle } from './random';

/** 초급 단계: 1 = 자음 하나, 2 = 자음 두 개 */
export type Stage = 1 | 2;

/**
 * 방향이 두 개인 이유.
 * - 숫자 → 자음: 외울 때 쓰는 머리 (숫자를 보고 이미지를 만든다)
 * - 자음 → 숫자: 떠올릴 때 쓰는 머리 (이미지에서 숫자를 되꺼낸다)
 * 둘은 따로 는다. 한쪽만 하면 회상에서 막힌다.
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
   * 4지선다 보기. 답이 자음일 때만 쓴다.
   * 답이 숫자면 숫자 키를 직접 누르게 한다 — 보기에서 고르는 것보다 훨씬 강하게 는다.
   */
  choices?: string[];
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const groupOf = (d: string, map: ChosungMap) => map[d] ?? '?';
const letterOf = (d: string, map: ChosungMap) => {
  const g = groupOf(d, map);
  return g.length ? g[randBelow(g.length)] : '?';
};

export function makeQuestion(stage: Stage, unit: string, map: ChosungMap, direction?: Direction): Question {
  const dir: Direction = direction ?? (randBelow(2) === 0 ? 'toConsonant' : 'toDigit');

  if (stage === 1) {
    const d = unit;
    if (dir === 'toConsonant') {
      /*
       * 보기를 아무렇게나 뽑으면 'ㄴ' 하나짜리 정답에 'ㄱㅋㄲ' 같은 세 글자 보기가 섞여
       * 내용이 아니라 길이만 보고 찍게 된다. 같은 글자 수의 보기를 먼저 쓴다.
       * 7(ㅅㅆ)만은 두 글자 묶음이 하나뿐이라 맞출 짝이 없다. 대신 반대 방향(자음 → 숫자)은
       * 보기가 없어 이 구멍이 없고, 문제의 절반이 그쪽이다.
       */
      const len = groupOf(d, map).length;
      const pool = DIGITS.filter((x) => x !== d);
      const sameShape = pool.filter((x) => groupOf(x, map).length === len);
      const chosen = sameShape.length >= 3 ? sample(sameShape, 3) : sample(pool, 3);
      const others = chosen.map((x) => groupOf(x, map));
      return {
        unit, stage, direction: dir,
        prompt: d,
        answer: groupOf(d, map),
        choices: shuffle([groupOf(d, map), ...others]),
      };
    }
    return { unit, stage, direction: dir, prompt: letterOf(d, map), answer: d };
  }

  const [a, b] = [unit[0], unit[1]];
  if (dir === 'toConsonant') {
    const right = `${groupOf(a, map)} · ${groupOf(b, map)}`;
    const others = sample(DIGITS.filter((x) => x !== a), 3).map((x, i) => {
      /* 한 자리만 다른 보기를 섞어야 진짜로 두 자리를 다 읽는다 */
      const alt = sample(DIGITS.filter((y) => y !== b), 3)[i] ?? b;
      return i === 0 ? `${groupOf(a, map)} · ${groupOf(alt, map)}` : `${groupOf(x, map)} · ${groupOf(b, map)}`;
    });
    return {
      unit, stage, direction: dir,
      prompt: unit,
      answer: right,
      choices: shuffle([right, ...new Set(others.filter((o) => o !== right))]),
    };
  }
  return {
    unit, stage, direction: dir,
    prompt: `${letterOf(a, map)} ${letterOf(b, map)}`,
    answer: unit,
  };
}

/** 단계별 전체 단위 목록. 1단계는 0~9, 2단계는 00~99. */
export function allUnits(stage: Stage): string[] {
  return stage === 1 ? DIGITS : Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
}

export const statKey = (stage: Stage, unit: string) => `s${stage}:${unit}`;

/** 보기를 고르는 키. 왼손·오른손 검지와 중지로 네 개. */
export const CHOICE_KEYS = ['d', 'f', 'j', 'k'] as const;
