import { getSettings, type CoachLog } from '../db/db';
import type { SessionKind } from '../db/sessions';
import { AiError } from '../lib/ai';
import { askCourse, askReview } from './ask';
import { buildSessionReviewInput } from './review';
import { ruleCourse } from './rule';
import { claimAutoAsk, courseRowsOn, reviewFor, saveCourse, saveReview, usageThisMonth } from './store';
import { loadCoachSummary } from './summary';

/*
 * 스승님 — 화면이 부르는 입구. 숫자·판정은 코드, 말·계획은 AI(원칙 2). AI 가 없거나 실패하면 규칙 코치(원칙 3).
 */

export * from './types';
export {
  courseHref, courseStep, estimate, estimateMs, itemLabel, openMemoryEvents, playedMatches, MIN_ITEMS, MAX_ITEMS, MAX_COURSE_ITEMS,
  type PlayedRun,
} from './catalog';
export { buildSummary, loadCoachSummary, type CoachSummary, type SummaryInput } from './summary';
export { ruleCourse } from './rule';
export { validateCourse, validateReview, SAFE_SAY } from './validate';
export { askCourse, askReview } from './ask';
export { buildSessionReviewInput, type ReviewInput } from './review';
export {
  todayCourse, courseRowsOn, claimAutoAsk, saveCourse, markStep, usageThisMonth, sumUsage, shouldAutoAsk, reviewFor, saveReview, isAiCall,
  AUTO_CALL_CAP, PRICE_PER_M, type CoachUsage,
} from './store';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clampMinutes = (m: number) => Math.min(120, Math.max(3, Math.round(Number(m) || 15)));

/**
 * 코스를 새로 짜서 남긴다. useAi 이고 키가 있으면 스승님께, 아니면 규칙 코치.
 * 스승님이 실패하면(오류·쓸 항목 없음) 규칙 코스를 남기되 aiError 에 까닭을 적는다. 취소(signal)는 남기지 않는다.
 * claimId = 자동 호출의 자리표 행(claimAutoAsk) — 새 행 대신 그 행을 채운다.
 */
export async function makeCourse({ minutes, useAi, signal, now = Date.now(), claimId }: {
  minutes?: number; useAi: boolean; signal?: AbortSignal; now?: number; claimId?: string;
}): Promise<CoachLog> {
  const settings = await getSettings();
  const m = clampMinutes(minutes ?? settings.dailyMinutes);
  const summary = await loadCoachSummary(now);
  const key = settings.aiKey?.trim();
  const base = { minutes: m, input: summary, now, id: claimId };
  if (!useAi || !key) return saveCourse({ ...base, course: ruleCourse(summary, m), source: 'rule' });

  try {
    const r = await askCourse(key, summary, m, signal);
    if (r.course) return saveCourse({ ...base, course: r.course, source: 'ai', output: r.raw, usage: r.usage });
    return saveCourse({
      ...base, course: ruleCourse(summary, m), source: 'rule', output: r.raw, usage: r.usage, aiError: NO_USABLE_ITEMS,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return saveCourse({
      ...base, course: ruleCourse(summary, m), source: 'rule', usage: e instanceof AiError ? e.usage : undefined, aiError: errText(e),
    });
  }
}

/** 물어서 답은 받았으나 쓸 항목이 없던 때의 aiError — 홈은 이때 '묻지 못해' 가 아니라 '답을 쓸 수 없어' 로 적는다 */
export const NO_USABLE_ITEMS = '스승님 답에 쓸 수 있는 항목이 없어 규칙 코치가 짰습니다.';

let pending: Promise<CoachLog> | null = null;

/**
 * 홈을 열 때 — 오늘 코스를 돌려준다. 하루 1회 자동 조건(shouldAutoAsk)이면 스승님께 새로 묻고,
 * 아니면 오늘 것, 그것도 없으면 규칙 코스를 짠다. 동시에 두 번 불려도(개발 모드의 이중 effect) 한 번만 묻는다.
 */
export function ensureTodayCourse(now = Date.now()): Promise<CoachLog> {
  pending ??= (async () => {
    const [settings, rows, usage] = await Promise.all([getSettings(), courseRowsOn(now), usageThisMonth(now)]);
    const claimId = await claimAutoAsk(settings, usage, now);
    if (claimId) return makeCourse({ useAi: true, now, claimId });
    return rows.find((r) => !!r.course) ?? makeCourse({ useAi: false, now });
  })().finally(() => { pending = null; });
  return pending;
}

/**
 * 한 판 복기(버튼) — 이미 받은 복기가 있으면 그것을, 없으면 스승님께 묻는다.
 * 실패하면 오류를 던진다(쓴 토큰은 aiError 행으로 남겨 사용량에서 빠지지 않게).
 */
export async function reviewSession(kind: SessionKind, sessionId: string, signal?: AbortSignal): Promise<CoachLog> {
  const cached = await reviewFor(sessionId);
  if (cached) return cached;
  const key = (await getSettings()).aiKey?.trim();
  if (!key) throw new Error('설정에서 AI 키를 넣으면 스승님 복기를 받을 수 있습니다.');
  const input = await buildSessionReviewInput(kind, sessionId);
  if (!input) throw new Error('이 판의 기록을 찾지 못했습니다.');
  try {
    const r = await askReview(key, input, signal);
    if (r.review) return saveReview({ sessionId, input, output: r.raw, review: r.review, usage: r.usage });
    const msg = '스승님 답을 쓸 수 없어 버렸습니다(요약에 없는 숫자 등). 한 번 더 눌러 주십시오.';
    await saveReview({ sessionId, input, output: r.raw, usage: r.usage, aiError: msg });
    throw new Error(msg);
  } catch (e) {
    if (e instanceof AiError && !signal?.aborted) await saveReview({ sessionId, input, output: '', usage: e.usage, aiError: e.message });
    throw e;
  }
}
