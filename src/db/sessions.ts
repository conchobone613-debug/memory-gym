import {
  db,
  type CalcItem, type CalcSession, type DrillAttempt, type DrillSession,
  type MappingAttempt, type MappingSession, type RecallSession,
} from './db';
import { localDayKey } from './analytics';
import { findDiscipline, type Domain } from '../data/events';

/**
 * 통합 기록 — 저장이 아니라 **읽을 때** 합친다.
 *
 * 기록은 이미 네 가지 모양으로 쌓여 있다(자음 매핑 · 이미지 드릴 · 종목 회상 · 계산).
 * 그것을 한 모양으로 다시 저장하는 것이 기록을 깨뜨릴 수 있는 유일한 길이라, 원본은 그대로 두고
 * 여기서 같은 틀로 읽어 온다. 대시보드·연속일·스승님 요약표·내보내기가 모두 이 틀 위에서 돈다.
 * 새 영역이 생기면 읽는 함수 하나만 더한다.
 */

export type SessionKind = 'mapping' | 'drill' | 'recall' | 'calc';

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  domain: Domain;
  /** 종목 id. 기초는 'basics-1' ~ 'basics-3' */
  disciplineId: string;
  title: string;
  mode: 'practice' | 'contest';
  startedAt: number;
  /** 실제로 훈련한 시간. 켜 두고 자리를 비운 시간은 넣지 않는다(마지막 입력까지). */
  durationMs: number;
  items: number;
  correct: number;
  accuracy: number;
  /** 문항당 평균 반응시간. 종목 회상은 암기에 쓴 시간 ÷ 문항 수. 0 = 잴 것 없음 */
  perItemMs: number;
  /** 대회식 점수 — 종목 회상은 점수가 있는 종목(듣기·이진수), 계산은 끝까지 치른 모의 대회만. 없으면 칸이 없다 */
  score?: number;
}

interface Mark { shownAt: number; rtMs: number }

/** 마지막 입력이 끝난 때까지를 훈련 시간으로 본다. */
function activeMs(startedAt: number, marks: Mark[]): number {
  let end = startedAt;
  for (const m of marks) end = Math.max(end, m.shownAt + Math.max(0, m.rtMs));
  return end - startedAt;
}

function meanRt(marks: Mark[]): number {
  const rts = marks.map((m) => m.rtMs).filter((x) => x > 0);
  return rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
}

function byKey<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export interface RawLogs {
  mappingSessions: MappingSession[];
  mappingAttempts: MappingAttempt[];
  drillSessions: DrillSession[];
  drillAttempts: DrillAttempt[];
  recallSessions: RecallSession[];
  calcSessions: CalcSession[];
  calcItems: CalcItem[];
}

/** 순수 함수. 문항이 하나도 없는 세션(열었다 바로 닫은 것)은 뺀다. 최근 것이 앞. */
export function summarize(raw: RawLogs): SessionSummary[] {
  const out: SessionSummary[] = [];
  const push = (s: Omit<SessionSummary, 'accuracy'>) => {
    if (s.items > 0) out.push({ ...s, accuracy: s.correct / s.items });
  };

  const mapBy = byKey(raw.mappingAttempts, (a) => a.sessionId);
  for (const s of raw.mappingSessions) {
    const at = mapBy.get(s.id) ?? [];
    push({
      id: s.id, kind: 'mapping', domain: 'memory', disciplineId: `basics-${s.stage}`,
      title: `기초 ${s.stage}단계`, mode: 'practice', startedAt: s.startedAt,
      durationMs: activeMs(s.startedAt, at), items: at.length,
      correct: at.filter((a) => a.isCorrect).length, perItemMs: meanRt(at),
    });
  }

  const drillBy = byKey(raw.drillAttempts, (a) => a.sessionId);
  for (const s of raw.drillSessions) {
    const at = drillBy.get(s.id) ?? [];
    push({
      id: s.id, kind: 'drill', domain: 'memory', disciplineId: 'basics-3',
      title: '기초 3단계', mode: 'practice', startedAt: s.startedAt,
      durationMs: activeMs(s.startedAt, at), items: at.length,
      correct: at.filter((a) => a.verdict === 'correct').length, perItemMs: meanRt(at),
    });
  }

  for (const s of raw.recallSessions) {
    /* 종목 화면이 생기기 전 기록에는 eventId 가 없다. 그때는 숫자·카드로만 갈랐다. */
    const disciplineId = s.eventId ?? (s.mode === 'cards' ? 'speed-cards' : s.mode === 'binary' ? 'binary' : 'speed-numbers');
    const items = s.correct + s.wrong + s.blank;
    /* 낭독 간격이 있는 판(듣기)은 속도를 기계가 정해 문항당 시간이 제자의 속도가 아니다 */
    const paced = s.params?.intervalMs !== undefined;
    push({
      id: s.id, kind: 'recall', domain: 'memory', disciplineId,
      title: findDiscipline(disciplineId)?.name ?? s.presetName,
      /* runMode 가 없는 기록은 연습 모드가 생기기 전 것이라 모두 규격대로 한 판이다 */
      mode: s.runMode === 'easy' ? 'practice' : 'contest',
      startedAt: s.startedAt, durationMs: s.memorizeUsedMs + (s.recallUsedMs ?? 0),
      items, correct: s.correct,
      perItemMs: !paced && s.stimulus.length ? Math.round(s.memorizeUsedMs / s.stimulus.length) : 0,
      ...(s.score !== undefined ? { score: s.score } : {}),
    });
  }

  const calcBy = byKey(raw.calcItems, (a) => a.sessionId);
  for (const s of raw.calcSessions) {
    const at = calcBy.get(s.id) ?? [];
    push({
      id: s.id, kind: 'calc', domain: 'calc', disciplineId: s.disciplineId,
      title: findDiscipline(s.disciplineId)?.name ?? s.disciplineId, mode: s.mode,
      startedAt: s.startedAt, durationMs: activeMs(s.startedAt, at), items: at.length,
      correct: at.filter((a) => a.isCorrect).length, perItemMs: meanRt(at),
      /* 취소한 모의 대회(endedAt 없음)의 score 는 중간 값이라 두지 않는다 */
      ...(s.mode === 'contest' && s.endedAt ? { score: s.score } : {}),
    });
  }

  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function loadSummaries(since = 0): Promise<SessionSummary[]> {
  const [mappingSessions, mappingAttempts, drillSessions, drillAttempts, recallSessions, calcSessions, calcItems] =
    await Promise.all([
      db.mappingSessions.where('startedAt').above(since).toArray(),
      db.mappingAttempts.where('shownAt').above(since).toArray(),
      db.drillSessions.where('startedAt').above(since).toArray(),
      db.drillAttempts.where('shownAt').above(since).toArray(),
      db.recallSessions.where('startedAt').above(since).toArray(),
      db.calcSessions.where('startedAt').above(since).toArray(),
      db.calcItems.where('shownAt').above(since).toArray(),
    ]);
  return summarize({ mappingSessions, mappingAttempts, drillSessions, drillAttempts, recallSessions, calcSessions, calcItems });
}

/**
 * 연속 연습일과 오늘 채운 시간. 어느 영역이든 세션 하나를 끝낸 날을 센다.
 * 오늘 아직 안 했어도 어제까지 이어졌으면 연속은 살아 있다 — 오늘이 끝나기 전엔 끊긴 게 아니다.
 */
export function dayStreak(summaries: SessionSummary[], now = Date.now()): { streak: number; doneToday: boolean; todayMs: number } {
  const days = new Set(summaries.map((s) => localDayKey(s.startedAt)));
  const today = localDayKey(now);
  const todayMs = summaries.filter((s) => localDayKey(s.startedAt) === today).reduce((a, s) => a + s.durationMs, 0);
  const doneToday = days.has(today);

  const d = new Date(now);
  if (!doneToday) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(d.getTime()))) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return { streak, doneToday, todayMs };
}
