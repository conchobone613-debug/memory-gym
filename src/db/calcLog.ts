import { db, type CalcItem, type CalcSession } from './db';
import { summarize, type SessionSummary } from './sessions';

/** 계산 종목 하나의 기록 — 세션과 문항(원시 데이터) */
export interface CalcLog {
  sessions: CalcSession[];
  items: CalcItem[];
}

/** 종목 하나의 기록 전부. 개인 기록이라 양이 작아 통째로 읽는다. */
export async function loadCalcLog(disciplineId: string): Promise<CalcLog> {
  const sessions = await db.calcSessions.where('disciplineId').equals(disciplineId).toArray();
  const items = await db.calcItems.where('sessionId').anyOf(sessions.map((s) => s.id)).toArray();
  return { sessions, items };
}

/** 세션마다 통합 기록(sessions.ts)과 같은 잣대의 요약. 문항 없는 세션은 빠진다. 최근 것이 앞 */
export function calcSummaries(log: CalcLog): SessionSummary[] {
  return summarize({
    mappingSessions: [], mappingAttempts: [], drillSessions: [], drillAttempts: [], recallSessions: [],
    calcSessions: log.sessions, calcItems: log.items,
  });
}
