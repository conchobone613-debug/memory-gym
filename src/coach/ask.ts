import { callJson, type AiUsage } from '../lib/ai';
import {
  COURSE_SYSTEM, courseSchema, courseUser, REVIEW_SCHEMA, REVIEW_SYSTEM, reviewUser, WEEKLY_SCHEMA, WEEKLY_SYSTEM, weeklyUser,
} from './prompts';
import { validateCourse, validateReview, validateWeekly } from './validate';
import type { CoachSummary } from './summary';
import type { ReviewInput } from './review';
import type { WeeklyInput } from './weekly';
import type { Course, Review, WeeklyReview } from './types';

/*
 * 스승님께 묻는다 — 호출은 lib/ai.ts 의 callJson 하나를 지난다. 답은 반드시 검사(validate.ts)를 거친다.
 * 검사에서 다 빠지면 course/review 가 null — 부르는 쪽이 규칙 코치로 떨어지거나 오류를 알린다.
 */

/* 코스 5항목 × 60여 토큰 + 말. 넉넉히 잡아 잘리지 않게 한다(잘리면 AiError) */
const COURSE_MAX_TOKENS = 1200;
const REVIEW_MAX_TOKENS = 600;
/* 말 2~3문장 + 할 일 3줄 */
const WEEKLY_MAX_TOKENS = 800;

export async function askCourse(apiKey: string, s: CoachSummary, minutes: number, signal?: AbortSignal)
  : Promise<{ course: Course | null; raw: string; usage: AiUsage }> {
  const { data, text, usage } = await callJson({
    apiKey, system: COURSE_SYSTEM, user: courseUser(s, minutes), schema: courseSchema(), maxTokens: COURSE_MAX_TOKENS, signal,
  });
  return { course: validateCourse(data, s, minutes), raw: text, usage };
}

export async function askReview(apiKey: string, input: ReviewInput, signal?: AbortSignal)
  : Promise<{ review: Review | null; raw: string; usage: AiUsage }> {
  const { data, text, usage } = await callJson({
    apiKey, system: REVIEW_SYSTEM, user: reviewUser(input), schema: REVIEW_SCHEMA, maxTokens: REVIEW_MAX_TOKENS, signal,
  });
  return { review: validateReview(data, input), raw: text, usage };
}

export async function askWeekly(apiKey: string, input: WeeklyInput, signal?: AbortSignal)
  : Promise<{ weekly: WeeklyReview | null; raw: string; usage: AiUsage }> {
  const { data, text, usage } = await callJson({
    apiKey, system: WEEKLY_SYSTEM, user: weeklyUser(input), schema: WEEKLY_SCHEMA, maxTokens: WEEKLY_MAX_TOKENS, signal,
  });
  return { weekly: validateWeekly(data, input), raw: text, usage };
}
