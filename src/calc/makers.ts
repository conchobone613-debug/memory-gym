import type { RuleValues } from '../db/db';
import { sessionType, type CalcLevelDef } from './ladders';
import type { Problem } from './problem';
import type { Rng } from './rng';
import { makeAddition, makeMultiply } from './arith';
import { makeSqrt, ROUNDING_NAME, type Rounding } from './sqrt';
import { makeSurprise, makeSurpriseRun, MIX, surpriseAsk, surpriseTypeOptions } from './surprise';

/*
 * 종목별 문항 만들기 — 달력을 뺀 계산 종목의 공통 실행기는 이 표만 본다. 새 종목은 여기 한 줄을 더한다.
 * params = 한 판의 문항 설정(세션 params 에 그대로 남긴다): 연습 칸의 설정을 규정 위에 덮고, 모의 대회 칸은 규정 그대로.
 */

export interface CalcMaker {
  params(rules: RuleValues, level: CalcLevelDef): RuleValues;
  make(rng: Rng, params: RuleValues): Problem;
  /** 답을 어떻게 적나(평문 한 줄) — 설정 화면과 문제 카드 안내 줄에 적는다 */
  ask(params: RuleValues): string;
  /** 연습에서 플래시 암산을 켤 수 있다 — 문항의 lines 를 하나씩 비춘다 */
  flash?: boolean;
  /** 한 판 문항을 한 번에 — 있으면 실행기가 make 대신 쓴다(서프라이즈 섞기는 유형이 고르게 돌도록 판 단위로 순서를 정한다) */
  makeAll?(rng: Rng, params: RuleValues, count: number): Problem[];
  /** 연습 칸에서 고를 유형(첫 값 = 섞기, 기본). 고르면 params.type 을 그 값으로 덮는다 */
  typeOptions?(): { value: string; label: string }[];
}

const rounding = (v: unknown): Rounding => (v === 'round' ? 'round' : 'trunc');
const surpriseCtx = (p: RuleValues) => ({ rounding: rounding(p.rounding) });

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
  addition: {
    params: (rules, level) => ({
      digits: Number(level.params?.digits ?? rules.digits),
      terms: Number(level.params?.terms ?? rules.terms),
    }),
    make: (rng, p) => makeAddition(rng, { digits: Number(p.digits), terms: Number(p.terms) }),
    ask: (p) => `${Number(p.terms)}개의 합`,
    flash: true,
  },
  multiplication: {
    params: (rules, level) => ({
      digitsA: Number(level.params?.digitsA ?? rules.digitsA),
      digitsB: Number(level.params?.digitsB ?? rules.digitsB),
    }),
    make: (rng, p) => makeMultiply(rng, { a: Number(p.digitsA), b: Number(p.digitsB) }),
    ask: () => '곱',
  },
  surprise: {
    params: (rules, level) => ({ type: String(level.params?.type ?? MIX), rounding: rounding(rules.rounding) }),
    make: (rng, p) => makeSurprise(rng, surpriseCtx(p), { type: String(p.type ?? MIX) }),
    makeAll: (rng, p, count) => makeSurpriseRun(rng, surpriseCtx(p), count, { type: String(p.type ?? MIX) }),
    ask: (p) => surpriseAsk(surpriseCtx(p), String(p.type ?? MIX)),
    typeOptions: () => surpriseTypeOptions(),
  },
};

/** 유형을 골라 한 판(서프라이즈 연습)이면 그 유형 이름 — 종목 화면 기록 줄에 붙인다. 섞기·유형 없는 판은 null */
export function calcTypeLabel(eventId: string, params: RuleValues): string | null {
  const t = sessionType(params);
  return t ? (CALC_MAKERS[eventId]?.typeOptions?.().find((o) => o.value === t)?.label ?? t) : null;
}
