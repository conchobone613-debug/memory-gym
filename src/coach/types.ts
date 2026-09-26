import type { PickMode } from '../db/db';

/*
 * 스승님(AI 코치)의 코스 — 코드가 아는 것만 들어간다(열린 종목, 사다리 칸).
 * 숫자(예상 분)는 코드가 계산하고, 말(say·why)만 스승님 또는 규칙 코치가 붙인다(기획서 원칙 2).
 */

export type CourseItem =
  /** 기초 드릴. pick 은 3단계에서만(srs 골고루 · weak 약한 칸 · unseen 안 본 칸 · all 전부) */
  | { kind: 'basics'; stage: 1 | 2 | 3; items: number; pick?: PickMode }
  /** 달력 사다리 칸. 5 = 1분 모의 대회(items 0, 무시). steps = 단계 입력(3·4칸만) */
  | { kind: 'calendar'; level: 1 | 2 | 3 | 4 | 5; items: number; steps?: boolean }
  /** 열린 기억력 종목. 분량은 종목 프리셋 그대로 — easy 연습(1/4, 시간 안 잼) · real 모의 대회 */
  | { kind: 'event'; eventId: string; run: 'easy' | 'real' }
  /** 달력을 뺀 열린 계산 종목의 사다리 칸(calc/ladders). 마지막 칸 = 모의 대회(items 0, 무시) */
  | { kind: 'calc'; eventId: string; level: number; items: number };

/** 코스에 올린 항목 — estMinutes 는 코드가 계산(estimate), why 는 평문 한 줄(…습니다) */
export type PlannedItem = CourseItem & { estMinutes: number; why: string };

export interface Course {
  /** 스승님 말 — 하게체 두 문장 이내, 숫자는 요약표에 있는 값만 */
  say: string;
  items: PlannedItem[];
}

/** 한 판 복기 */
export interface Review {
  /** 하게체 2~3문장, 실제 값만 */
  say: string;
  /** 다음에 할 한 가지 — 평문 한 줄. 요약에 없는 숫자가 섞였으면 빈 글자 */
  next: string;
}

/** 스승님 주간 리뷰 */
export interface WeeklyReview {
  /** 하게체 2~3문장, 주간 표에 있는 값만 */
  say: string;
  /** 다음 주에 할 일 — 평문 한 줄씩, 0~3개 */
  focus: string[];
}
