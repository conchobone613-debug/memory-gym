import type { RuleValues } from '../db/db';
import type { CalcLevelDef } from './ladders';
import type { Problem } from './problem';
import type { Rng } from './rng';
import { makeSqrt, ROUNDING_NAME, type Rounding } from './sqrt';

/*
 * 종목별 문항 만들기 — 달력을 뺀 계산 종목의 공통 실행기는 이 표만 본다. 새 종목은 여기 한 줄을 더한다.
 * params = 한 판의 문항 설정(세션 params 에 그대로 남긴다): 연습 칸의 설정을 규정 위에 덮고, 모의 대회 칸은 규정 그대로.
 */

export interface CalcMaker {
  params(rules: RuleValues, level: CalcLevelDef): RuleValues;
  make(rng: Rng, params: RuleValues): Problem;
  /** 답을 어떻게 적나(평문 한 줄) — 설정 화면과 문제 카드 안내 줄에 적는다 */
  ask(params: RuleValues): string;
}

const rounding = (v: unknown): Rounding => (v === 'round' ? 'round' : 'trunc');

export const CALC_MAKERS: Record<string, CalcMaker> = {
  sqrt: {
    params: (rules, level) => ({
      digits: Number(level.params?.digits ?? rules.digits),
      sig: Number(level.params?.sig ?? rules.sigDigits),
      /* 끝자리(버림·반올림)는 연습에서도 규정을 따른다 */
      rounding: rounding(level.params?.rounding ?? rules.rounding),
    }),
    make: (rng, p) => makeSqrt(rng, { digits: Number(p.digits), sig: Number(p.sig), rounding: rounding(p.rounding) }),
    ask: (p) => `유효숫자 ${Number(p.sig)}자리 · ${ROUNDING_NAME[rounding(p.rounding)]}`,
  },
};
