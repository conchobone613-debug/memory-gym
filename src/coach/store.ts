import { db, type AppSettings, type CoachLog } from '../db/db';
import { localDayKey } from '../db/analytics';
import { uid } from '../lib/random';
import type { AiUsage } from '../lib/ai';
import type { CoachSummary } from './summary';
import type { ReviewInput } from './review';
import { playedMatches, type PlayedRun } from './catalog';
import type { Course, Review } from './types';

/*
 * 스승님 기록(coachLogs) — 코스·복기 한 번이 한 행. 규칙 코치가 짠 코스도 남긴다
 * (AI 코스와 규칙 코스를 '실제로 따라 한 비율' 로 견주는 근거, 기획서 §8.2).
 */

/** 이번 달 스승님 호출이 이만큼이면 하루 1회 자동 호출을 멈춘다(안전판). 버튼으로 부르는 것은 막지 않는다 */
export const AUTO_CALL_CAP = 300;
/** Sonnet 5 가격(USD / 백만 토큰) — 사용량 표시용 어림값 */
export const PRICE_PER_M = { input: 3, output: 15 };

/** AI 를 부른 행인가 — 코스가 스승님 것이거나, 물었다가 실패해 규칙 코스로 떨어졌거나 */
export const isAiCall = (l: CoachLog) => l.source === 'ai' || l.aiError != null;

const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** 그날의 코스 행들, 최근 것이 앞. 스승님께 묻는 중인 자리표 행(course 없음)도 들어 있다 */
export async function courseRowsOn(now = Date.now()): Promise<CoachLog[]> {
  const day = localDayKey(now);
  const rows = await db.coachLogs.where('at').aboveOrEqual(midnight(now)).toArray();
  return rows.filter((r) => r.kind === 'course' && r.day === day).sort((a, b) => b.at - a.at);
}

/** 오늘의 코스(코스가 있는 가장 최근 행). 없으면 undefined */
export const todayCourse = async (now = Date.now()) => (await courseRowsOn(now)).find((r) => !!r.course);

/**
 * 하루 1회 자동 호출의 자리를 잡는다 — 오늘 아직 스승님께 묻지 않았으면 '묻는 중' 자리표 행을 먼저 넣고 그 id 를 돌려준다.
 * 확인과 기록을 한 트랜잭션에 묶어, 창 두 개(PWA 창·브라우저 탭)가 함께 홈을 열어도 한 곳만 묻는다.
 * 자리표는 source 'ai' 라 호출 1회로 세고(isAiCall), 답이 오면 saveCourse({ id }) 가 같은 행을 채운다.
 * 묻는 사이 새로고침해 답을 못 받아도 자리표가 남아 같은 날 또 묻지 않고, 사용량에도 1회로 남는다.
 */
export async function claimAutoAsk(
  settings: Pick<AppSettings, 'aiKey' | 'coachAuto'>, usage: Pick<CoachUsage, 'calls'>, now = Date.now(),
): Promise<string | null> {
  return db.transaction('rw', db.coachLogs, async () => {
    if (!shouldAutoAsk(settings, await courseRowsOn(now), usage)) return null;
    const id = uid();
    await db.coachLogs.add({ id, kind: 'course', at: now, day: localDayKey(now), input: null, output: '', source: 'ai' });
    return id;
  });
}

export interface SaveCourse {
  course: Course;
  source: 'ai' | 'rule';
  minutes: number;
  /** 보낸(또는 규칙 코치가 읽은) 요약표 */
  input: CoachSummary;
  /** 받은 답 원문(규칙 코스는 빈 글자) */
  output?: string;
  usage?: AiUsage;
  aiError?: string;
  now?: number;
  /** 자동 호출의 자리표 행(claimAutoAsk) — 주면 그 행을 채운다 */
  id?: string;
}

export async function saveCourse(a: SaveCourse): Promise<CoachLog> {
  const at = a.now ?? Date.now();
  const row: CoachLog = {
    id: a.id ?? uid(), kind: 'course', at, day: localDayKey(at), input: a.input, output: a.output ?? '',
    source: a.source, course: a.course, done: a.course.items.map(() => null), minutes: a.minutes, followed: false,
    ...(a.usage ? { inputTokens: a.usage.input, outputTokens: a.usage.output } : {}),
    ...(a.aiError ? { aiError: a.aiError } : {}),
  };
  await db.coachLogs.put(row);
  return row;
}

/**
 * 코스 항목 하나를 끝냈다고 적는다. 항목을 다 끝내면 followed = true.
 * played(그 판의 실제 설정)를 주면 항목과 맞을 때만 적는다 — 설정 화면에서 칸·프리셋을 바꿔 한 판은 치지 않는다.
 */
export async function markStep(logId: string, index: number, sessionId: string, played?: PlayedRun): Promise<CoachLog | undefined> {
  return db.transaction('rw', db.coachLogs, async () => {
    const row = await db.coachLogs.get(logId);
    if (!row?.course || !Number.isInteger(index) || index < 0 || index >= row.course.items.length) return undefined;
    if (played && !playedMatches(row.course.items[index], played)) return undefined;
    const done = row.course.items.map((_, i) => row.done?.[i] ?? null);
    done[index] = sessionId;
    const followed = done.every((d) => d != null);
    await db.coachLogs.update(logId, { done, followed });
    return { ...row, done, followed };
  });
}

export interface CoachUsage { calls: number; inputTokens: number; outputTokens: number; usd: number }

/** 순수 함수 — now 가 속한 달(현지)의 스승님 호출 합계 */
export function sumUsage(logs: CoachLog[], now = Date.now()): CoachUsage {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const mine = logs.filter((l) => l.at >= from && l.at < to && isAiCall(l));
  const inputTokens = mine.reduce((a, l) => a + (l.inputTokens ?? 0), 0);
  const outputTokens = mine.reduce((a, l) => a + (l.outputTokens ?? 0), 0);
  const usd = (inputTokens * PRICE_PER_M.input + outputTokens * PRICE_PER_M.output) / 1_000_000;
  return { calls: mine.length, inputTokens, outputTokens, usd: Math.round(usd * 10_000) / 10_000 };
}

export async function usageThisMonth(now = Date.now()): Promise<CoachUsage> {
  const d = new Date(now);
  return sumUsage(await db.coachLogs.where('at').aboveOrEqual(new Date(d.getFullYear(), d.getMonth(), 1).getTime()).toArray(), now);
}

/**
 * 하루 1회 자동 호출 여부 — 키 있음 + 자동 켬(기본) + 이번 달 상한 전 + 오늘 아직 스승님께 묻지 않음.
 * 오늘 물었다가 실패한 것(aiError)도 '물은 것' 으로 센다 — 홈을 열 때마다 같은 실패를 되풀이하지 않게.
 */
export function shouldAutoAsk(
  settings: Pick<AppSettings, 'aiKey' | 'coachAuto'>, todayLogs: CoachLog[], usage: Pick<CoachUsage, 'calls'>,
): boolean {
  return !!settings.aiKey?.trim() && settings.coachAuto !== false && usage.calls < AUTO_CALL_CAP
    && !todayLogs.some((l) => l.kind === 'course' && isAiCall(l));
}

/** 이 판의 복기(검사를 마친 것). 이미 받았으면 다시 부르지 않는다 */
export async function reviewFor(sessionId: string): Promise<CoachLog | undefined> {
  const rows = await db.coachLogs.where('kind').equals('review').filter((r) => r.sessionId === sessionId && !!r.review).toArray();
  return rows.sort((a, b) => b.at - a.at)[0];
}

export async function saveReview(a: {
  sessionId: string; input: ReviewInput; output: string; review?: Review; usage?: AiUsage; aiError?: string; now?: number;
}): Promise<CoachLog> {
  const row: CoachLog = {
    id: uid(), kind: 'review', at: a.now ?? Date.now(), input: a.input, output: a.output, source: 'ai', sessionId: a.sessionId,
    ...(a.review ? { review: a.review } : {}),
    ...(a.usage ? { inputTokens: a.usage.input, outputTokens: a.usage.output } : {}),
    ...(a.aiError ? { aiError: a.aiError } : {}),
  };
  await db.coachLogs.add(row);
  return row;
}
