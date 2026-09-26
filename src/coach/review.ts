import { db, ERROR_TAG_LABEL, type ErrorTag } from '../db/db';
import { localDayKey } from '../db/analytics';
import { loadSummaries, type SessionKind } from '../db/sessions';
import { goalFor } from '../db/goals';
import { CAL_LEVELS, contestSessions, practiceIds } from '../calc/calendarLadder';
import { stepAverages } from '../calc/calendarDrill';
import { WEEKDAY_LONG } from '../calc/calendar';
import { calcLevels, calcPracticeIds } from '../calc/ladders';
import { calcContestSessions } from '../calc/calcOutcome';
import { CALC_EVENTS, MEMORY_EVENTS } from '../data/events';

/*
 * 한 판 복기의 입력 — 그 판의 요약만(원시 기록 전체를 보내지 않는다).
 * 기초 1·2단계 = mappingAttempts, 3단계 = drillAttempts, 기억력 종목 = recallCells, 달력 = calcItems.
 */

export interface ReviewInput {
  title: string;
  mode: 'practice' | 'contest';
  items: number;
  correct: number;
  accuracyPct: number;
  /** 문항당 반응시간(초). 기억력 종목은 암기 시간 ÷ 문항 수 */
  secPerItem: number | null;
  minutes: number;
  /** 이 칸의 통과 기준 */
  target?: { accuracyPct: number; sec: number };
  /** 느린 문항 상위 */
  slowest: { prompt: string; answer: string; sec: number }[];
  /** 틀린 문항 상위 */
  wrong: { prompt: string; expected: string; given: string }[];
  /** 달력 단계 입력의 단계별 평균 */
  steps?: { name: string; avgSec: number }[];
  /** 기억력 종목의 오답 원인 태그 */
  errorTags?: { tag: string; count: number }[];
  /** 같은 종목·같은 모드의 지난 판 */
  previous?: { day: string; accuracyPct: number; secPerItem: number | null };
  /** 대회식 점수가 있는 종목(듣기·이진수)의 그 판 점수 — 예: 처음 틀린 곳까지 34자리 */
  contestScore?: { label: string; value: number; unit: string };
}

const TOP = 5;
const pct = (x: number) => Math.round(x * 100);
const sec = (ms: number) => Math.round(ms / 10) / 100;
const orBlank = (s?: string) => (s ? s : '모름');

interface Row { prompt: string; answer: string; given: string; ok: boolean; rtMs: number }

const slowOf = (rows: Row[]) => rows.filter((r) => r.rtMs > 0).sort((a, b) => b.rtMs - a.rtMs).slice(0, TOP)
  .map((r) => ({ prompt: r.prompt, answer: r.answer, sec: sec(r.rtMs) }));
const wrongOf = (rows: Row[]) => rows.filter((r) => !r.ok).slice(0, TOP)
  .map((r) => ({ prompt: r.prompt, expected: r.answer, given: orBlank(r.given) }));

/** 이 계산 판과 견줄 수 있는 판들의 id */
async function calcPeers(disciplineId: string, sessionId: string): Promise<Set<string>> {
  const sessions = await db.calcSessions.where('disciplineId').equals(disciplineId).toArray();
  const me = sessions.find((s) => s.id === sessionId);
  if (!me) return new Set();
  const log = { sessions, items: [] };
  /* 달력 밖 계산 종목 — 연습은 같은 칸, 모의 대회는 같은 규정 */
  const ev = CALC_EVENTS.find((e) => e.id === disciplineId);
  if (ev && disciplineId !== 'calendar') {
    return me.mode === 'practice'
      ? calcPracticeIds(log, Number(me.params.level))
      : new Set(calcContestSessions(log, ev, me.rules).map((s) => s.id));
  }
  if (me.mode === 'practice') return practiceIds(log, Number(me.params.level), !!Number(me.params.steps || 0));
  return new Set(contestSessions(log, {
    limitSec: Number(me.params.limitSec), penalty: Number(me.rules.penaltyPerWrong) || 0,
    yearFrom: Number(me.params.yearFrom), yearTo: Number(me.params.yearTo),
  }).map((s) => s.id));
}

export async function buildSessionReviewInput(kind: SessionKind, sessionId: string, now = Date.now()): Promise<ReviewInput | null> {
  const all = await loadSummaries(now - 365 * 86_400_000);
  const me = all.find((s) => s.id === sessionId && s.kind === kind);
  if (!me) return null;
  /* 달력은 칸이 달라도 disciplineId 가 같다 — 성적표의 신기록 비교처럼 같은 칸·같은 단계 입력(모의 대회는 같은 조건)끼리만 견준다 */
  const peers = kind === 'calc' ? await calcPeers(me.disciplineId, sessionId) : null;
  const prev = all.find((s) => s.disciplineId === me.disciplineId && s.mode === me.mode && s.startedAt < me.startedAt
    && (!peers || peers.has(s.id)));

  const out: ReviewInput = {
    title: me.title, mode: me.mode, items: me.items, correct: me.correct, accuracyPct: pct(me.accuracy),
    secPerItem: me.perItemMs ? sec(me.perItemMs) : null, minutes: Math.round(me.durationMs / 6000) / 10,
    slowest: [], wrong: [],
    ...(prev ? { previous: { day: localDayKey(prev.startedAt), accuracyPct: pct(prev.accuracy), secPerItem: prev.perItemMs ? sec(prev.perItemMs) : null } } : {}),
  };
  const goal = async (stage: 1 | 2 | 3) => {
    const g = await goalFor(stage);
    out.target = { accuracyPct: pct(g.rule.accuracy), sec: sec(g.rule.rtMs) };
  };

  if (kind === 'mapping') {
    const at = (await db.mappingAttempts.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.order - b.order);
    const rows = at.map((a) => ({ prompt: a.prompt, answer: a.answer, given: a.given, ok: a.isCorrect, rtMs: a.rtMs }));
    out.slowest = slowOf(rows);
    out.wrong = wrongOf(rows);
    if (at[0]) await goal(at[0].stage);
  } else if (kind === 'drill') {
    const at = (await db.drillAttempts.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.order - b.order);
    const images = await db.images.bulkGet([...new Set(at.map((a) => a.imageId))]);
    const nameOf = new Map(images.filter((i) => !!i).map((i) => [i!.id, i!.name]));
    const rows = at.map((a) => ({
      prompt: a.stimulus ?? a.key, answer: nameOf.get(a.imageId) ?? '', given: a.typedInput ?? '',
      ok: a.verdict === 'correct', rtMs: a.rtMs,
    }));
    out.slowest = slowOf(rows);
    out.wrong = wrongOf(rows);
    await goal(3);
  } else if (kind === 'recall') {
    const cells = (await db.recallCells.where('sessionId').equals(sessionId).toArray()).sort((a, b) => a.index - b.index);
    out.wrong = cells.filter((c) => !c.isCorrect).slice(0, TOP)
      .map((c) => ({ prompt: `${c.index + 1}번째 칸`, expected: c.expected, given: c.answered || '빈칸' }));
    const tags = new Map<ErrorTag, number>();
    for (const c of cells) for (const t of c.errorTags) tags.set(t, (tags.get(t) ?? 0) + 1);
    if (tags.size) out.errorTags = [...tags].sort((a, b) => b[1] - a[1]).map(([t, count]) => ({ tag: ERROR_TAG_LABEL[t], count }));
    const session = await db.recallSessions.get(sessionId);
    const meta = MEMORY_EVENTS.find((e) => e.id === me.disciplineId)?.score;
    if (session?.score !== undefined && meta) out.contestScore = { label: meta.label, value: session.score, unit: meta.unit };
  } else {
    const [session, items] = await Promise.all([
      db.calcSessions.get(sessionId),
      db.calcItems.where('sessionId').equals(sessionId).toArray(),
    ]);
    /* 요일 문항의 답은 0~6 번호로 저장된다 — 읽을 수 있게 요일 이름으로 */
    const val = (itemKind: string, v: string) => (itemKind === 'full' && v !== '' && WEEKDAY_LONG[Number(v)]) || v;
    const rows = items.sort((a, b) => a.index - b.index).map((i) => ({
      prompt: i.prompt, answer: val(i.kind, i.expected), given: val(i.kind, i.answered), ok: i.isCorrect, rtMs: i.rtMs,
    }));
    out.slowest = slowOf(rows);
    out.wrong = wrongOf(rows);
    const steps = stepAverages(items.map((i) => ({ steps: i.steps?.filter((st) => st.ok !== false) })));
    if (steps.length) out.steps = steps.map((x) => ({ name: x.name, avgSec: sec(x.avgMs) }));
    const levels = me.disciplineId === 'calendar' ? CAL_LEVELS : calcLevels(me.disciplineId);
    const pass = session?.mode === 'practice' ? levels.find((l) => l.n === Number(session.params.level))?.pass : undefined;
    if (pass) out.target = { accuracyPct: pct(pass.accuracy), sec: pass.medianMs / 1000 };
  }
  return out;
}
