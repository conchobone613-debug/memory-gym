import { db, type AppSettings, type CoachLog } from '../db/db';
import { claimAutoAsk, itemLabel, makeCourse, type CoachUsage, type CourseItem } from '../coach';

/*
 * 코스 화면(홈 서류철 · CourseBar)이 함께 쓰는 계산과 '짜는 중' 상태 — 시험(course.test.ts)으로 확인한다.
 */

/** 오늘 쓸 시간 고르기 — 지금 코스의 분량이 이 안에 없으면 그 값도 끼운다 */
export const MINUTE_OPTIONS = [5, 10, 15, 20, 30];
export const minuteOptions = (current?: number) =>
  [...new Set([...MINUTE_OPTIONS, ...(current ? [current] : [])])].sort((a, b) => a - b);

/** 기본 분량 = 하루 목표에서 오늘 채운 분을 뺀 값, 최소 5분 */
export const defaultCourseMinutes = (dailyMinutes: number, todayMs: number) =>
  Math.max(5, Math.round(dailyMinutes) - Math.floor(todayMs / 60_000));

/**
 * 다음에 할 항목 — from 다음부터 끝까지, 없으면 처음부터 from 앞까지 아직 안 한(null) 항목. 없으면 -1.
 * 홈은 from = -1(처음부터), 결과 화면은 방금 끝낸 순번을 넘긴다.
 */
export function nextCourseIndex(done: readonly (string | null | undefined)[], from = -1): number {
  const n = done.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    if (i !== from && done[i] == null) return i;
  }
  return -1;
}

/** 항목 이름을 둘로 — 카드 제목(종목·칸)과 그 아래 분량('30문항 · 약한 칸'). 제목 줄은 한 줄이라 길면 잘린다 */
export function labelParts(item: CourseItem): [string, string] {
  const parts = itemLabel(item).split(' · ');
  return [parts.slice(0, 2).join(' · '), parts.slice(2).join(' · ')];
}

/*
 * 코스 짜기 — 이 탭 안에서 홈을 떠났다 와도 이어지는 두 가지(모듈 안).
 *   job    — 짜는 중인 코스. 홈을 다시 열어도 같은 물음을 두 번 보내지 않는다. 물음은 거두지 않는다 —
 *            이미 보낸 물음을 거두면 쓴 토큰이 기록에서 빠지고, 다음에 홈을 열 때 또 묻게 된다.
 *   opened — 홈에서 코스 항목을 연 코스 행과 그때. 묻는 사이 하던 코스를 열었으면(시작) 늦게 온 새 코스가
 *            그것을 밀어내지 않게 새 행을 그 바로 뒤로 물린다(오늘의 코스 = 가장 최근 행).
 */
export interface CourseJob { promise: Promise<CoachLog>; minutes: number; ai: boolean }
let job: CourseJob | null = null;
let opened: { id: string; at: number } | null = null;

export const courseJob = () => job;
export const markOpened = (id: string, at = Date.now()) => { opened = { id, at }; };

/**
 * 코스를 새로 짠다(실패해도 makeCourse 가 규칙 코스를 남긴다). 돌려주는 행 = 짠 뒤의 오늘의 코스.
 * auto = 하루 1회 자동 호출 — 다른 창이 오늘 이미 물었으면(claimAutoAsk 가 null) 묻지 않고 base 를 돌려준다.
 * 밀려난 행(갈아 끼운 base, 또는 하던 코스 뒤로 물린 새 행)에는 superseded 를 적는다 — 따른 비율을 셀 때 뺀다.
 */
export function startCourseJob(
  minutes: number, useAi: boolean, base?: CoachLog,
  auto?: { settings: Pick<AppSettings, 'aiKey' | 'coachAuto'>; usage: Pick<CoachUsage, 'calls'> },
): CourseJob {
  const t = Date.now();
  const promise = (async () => {
    const claimId = auto ? await claimAutoAsk(auto.settings, auto.usage) : null;
    if (auto && !claimId) return base ?? makeCourse({ minutes, useAi: false });
    const r = await makeCourse({ minutes, useAi, claimId: claimId ?? undefined });
    if (!base || r.id === base.id) return r;
    if (opened?.id === base.id && opened.at >= t) {
      await db.coachLogs.update(r.id, { at: base.at - 1, superseded: true });
      return base;
    }
    await db.coachLogs.update(base.id, { superseded: true });
    return r;
  })().finally(() => { job = null; });
  job = { promise, minutes, ai: useAi };
  return job;
}
