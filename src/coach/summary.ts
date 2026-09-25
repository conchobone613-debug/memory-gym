import { CALC_EVENTS } from '../data/events';
import { db, getSettings } from '../db/db';
import { dayStreak, loadSummaries, type SessionSummary } from '../db/sessions';
import { localDayKey, movers, type MoverRow } from '../db/analytics';
import { goalFor, LADDERS, type GoalStatus } from '../db/goals';
import { calcSummaries, loadCalcLog, type CalcLog } from '../db/calcLog';
import { CAL_LEVELS, CALENDAR_LADDER, currentLevel, ladderStatus } from '../calc/calendarLadder';
import { stepAverages } from '../calc/calendarDrill';
import { getRules } from '../lib/rules';
import { median } from '../lib/srs';
import { openMemoryEvents } from './catalog';

/*
 * 훈련 요약표 — 스승님께 보내는 작고 사실만 담은 표(기획서 §6.2). 원시 기록은 보내지 않는다.
 * 숫자는 사람이 읽는 단위로 둔다(정확도 %, 시간 초·분). 스승님은 이 값을 그대로 옮겨 말하고,
 * 코드는 답에 이 표에 없는 숫자가 섞였는지 검사한다(validate.ts). 사람 신원 정보는 넣지 않는다.
 */

export interface BasicsRung {
  stage: 1 | 2 | 3;
  name: string;
  passed: boolean;
  /** 전체 칸. 3단계는 이름을 채운 이미지만 — 0 이면 낼 수 없다 */
  cells: number;
  /** needReps 번 이상 본 칸 */
  cellsDone: number;
  needReps: number;
  unseen: number;
  accuracyPct: number | null;
  needAccuracyPct: number;
  /** 중앙 반응시간(초) */
  medianSec: number | null;
  needSec: number;
  /** 최근 판에서 한 문항에 실제로 든 시간(초) — 예상 시간의 바탕 */
  paceSec: number | null;
  /** 최근 두 판 정확도(최근 것이 앞) — 무너짐 판정 */
  last2AccuracyPct: number[];
}

export interface CalendarRung {
  level: number;
  name: string;
  passed: boolean;
  /** 최근 창(needItems 문항) 안의 문항 수 */
  recentItems: number;
  needItems: number;
  accuracyPct: number | null;
  needAccuracyPct: number;
  medianSec: number | null;
  needSec: number;
  paceSec: number | null;
  last2AccuracyPct: number[];
}

export interface EventRecord {
  id: string;
  name: string;
  runs: number;
  lastDay: string | null;
  /** 마지막으로 한 지 며칠(오늘 = 0) */
  daysAgo: number | null;
  lastRun: 'easy' | 'real' | null;
  lastAccuracyPct: number | null;
  /** 최근 판 걸린 시간 중앙값(분) — 연습 / 모의 대회 */
  easyMin: number | null;
  realMin: number | null;
}

export interface RecentRow {
  id: string;
  name: string;
  mode: 'practice' | 'contest';
  sessions: number;
  items: number;
  accuracyPct: number;
  /** 문항당 반응시간 중앙값(초). 기억력 종목은 암기 시간 ÷ 문항 수 */
  secPerItem: number | null;
}

export interface CoachSummary {
  today: { date: string; weekday: string };
  daily: { goalMin: number; doneMin: number; streak: number };
  lastPracticeDay: string | null;
  /** current = 통과 못 한 첫 단계(0 = 셋 다 통과) */
  basics: { current: 0 | 1 | 2 | 3; stages: BasicsRung[] };
  /** current = 지금 칸(1~5). 한 칸 내리기로 정한 칸이 있으면 그 칸 */
  calendar: {
    current: number;
    levels: CalendarRung[];
    contest: { level: 5; name: string; runs: number; bestScore: number | null; limitSec: number };
  };
  events: EventRecord[];
  recent7: RecentRow[];
  recent30: RecentRow[];
  weak: {
    images: { key: string; name: string; medianSec: number; wrongPct: number }[];
    calendarSteps: { name: string; avgSec: number; n: number }[];
  };
}

export interface SummaryInput {
  now: number;
  dailyMinutes: number;
  /** 통합 기록(최근 것이 앞) */
  summaries: SessionSummary[];
  /** 기초 1·2·3단계 목표 */
  goals: GoalStatus[];
  calLog: CalcLog;
  /** 사다리 표에 적힌 달력 지금 칸 id */
  calStored?: string;
  /** 모의 대회 제한시간(초) */
  contestSec: number;
  slowImages: MoverRow[];
}

const DAY = 86_400_000;
const pct = (x: number) => Math.round(x * 100);
const sec = (ms: number) => Math.round(ms / 10) / 100;
const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** 최근 30일 안 10판까지에서 한 문항에 실제로 든 시간(초) */
function paceOf(list: SessionSummary[], now: number): number | null {
  const xs = list.filter((s) => now - s.startedAt <= 30 * DAY).slice(0, 10).map((s) => s.durationMs / s.items);
  return xs.length ? sec(median(xs)) : null;
}

const last2 = (list: SessionSummary[]) => list.slice(0, 2).map((s) => pct(s.accuracy));

function recentRows(summaries: SessionSummary[], now: number, days: number): RecentRow[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const s of summaries) {
    if (now - s.startedAt > days * DAY) continue;
    const k = `${s.disciplineId}|${s.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.values()].map((list) => {
    const items = list.reduce((a, s) => a + s.items, 0);
    const correct = list.reduce((a, s) => a + s.correct, 0);
    const rts = list.map((s) => s.perItemMs).filter((x) => x > 0);
    return {
      id: list[0].disciplineId, name: list[0].title, mode: list[0].mode, sessions: list.length,
      items, accuracyPct: pct(correct / items), secPerItem: rts.length ? sec(median(rts)) : null,
    };
  });
}

/** 순수 함수 — 기록에서 요약표를 만든다 */
export function buildSummary(inp: SummaryInput): CoachSummary {
  const { now, summaries, calLog } = inp;
  const { streak, todayMs } = dayStreak(summaries, now);

  const stages: BasicsRung[] = inp.goals.map((g) => {
    const mine = summaries.filter((s) => s.disciplineId === `basics-${g.stage}`);
    return {
      stage: g.stage, name: LADDERS[0].levels[g.stage - 1]?.name ?? '', passed: g.passed,
      cells: g.total, cellsDone: g.enough, needReps: g.rule.reps, unseen: g.unseen,
      accuracyPct: g.attempts ? pct(g.accuracy) : null, needAccuracyPct: pct(g.rule.accuracy),
      medianSec: g.medianRt ? sec(g.medianRt) : null, needSec: sec(g.rule.rtMs),
      paceSec: paceOf(mine, now), last2AccuracyPct: last2(mine),
    };
  });

  const statuses = ladderStatus(calLog);
  const calSums = calcSummaries(calLog);
  const levelOf = new Map(calLog.sessions.map((s) => [s.id, Number(s.params.level)]));
  const levels: CalendarRung[] = statuses.filter((st) => st.level.pass).map((st) => {
    const p = st.level.pass!;
    const mine = calSums.filter((x) => x.mode === 'practice' && levelOf.get(x.id) === st.level.n);
    return {
      level: st.level.n, name: st.level.name, passed: st.passed,
      recentItems: st.attempts, needItems: p.items,
      accuracyPct: st.attempts ? pct(st.accuracy) : null, needAccuracyPct: pct(p.accuracy),
      medianSec: st.medianRt ? sec(st.medianRt) : null, needSec: p.medianMs / 1000,
      paceSec: paceOf(mine, now), last2AccuracyPct: last2(mine),
    };
  });
  const contests = calLog.sessions.filter((s) => s.mode === 'contest' && !!s.endedAt);
  const contestLevel = CAL_LEVELS.find((l) => l.drill === 'contest')!;

  const events: EventRecord[] = openMemoryEvents().map((ev) => {
    const mine = summaries.filter((s) => s.kind === 'recall' && s.disciplineId === ev.id);
    const last = mine[0];
    const runMin = (mode: 'practice' | 'contest') => {
      const d = mine.filter((s) => s.mode === mode).slice(0, 5).map((s) => s.durationMs);
      return d.length ? Math.round(median(d) / 6000) / 10 : null;
    };
    return {
      id: ev.id, name: ev.name, runs: mine.length,
      lastDay: last ? localDayKey(last.startedAt) : null,
      daysAgo: last ? Math.round((midnight(now) - midnight(last.startedAt)) / DAY) : null,
      lastRun: last ? (last.mode === 'practice' ? 'easy' : 'real') : null,
      lastAccuracyPct: last ? pct(last.accuracy) : null,
      easyMin: runMin('practice'), realMin: runMin('contest'),
    };
  });

  /* 느린 단계는 맞게 친 단계만으로 잰다(결과 화면 '단계별 평균' 과 같은 잣대) */
  const recentCal = calLog.items.filter((i) => now - i.shownAt <= 30 * DAY).map((i) => ({ steps: i.steps?.filter((st) => st.ok !== false) }));

  return {
    today: { date: localDayKey(now), weekday: '일월화수목금토'[new Date(now).getDay()] },
    daily: { goalMin: inp.dailyMinutes, doneMin: Math.round(todayMs / 60_000), streak },
    lastPracticeDay: summaries[0] ? localDayKey(summaries[0].startedAt) : null,
    basics: { current: stages.find((r) => !r.passed)?.stage ?? 0, stages },
    calendar: {
      current: currentLevel(statuses, inp.calStored).n,
      levels,
      contest: {
        level: 5, name: contestLevel.name, runs: contests.length,
        bestScore: contests.length ? Math.max(...contests.map((s) => s.score)) : null, limitSec: inp.contestSec,
      },
    },
    events,
    recent7: recentRows(summaries, now, 7),
    recent30: recentRows(summaries, now, 30),
    weak: {
      images: inp.slowImages.map((m) => ({ key: m.key, name: m.name, medianSec: sec(m.medianRt), wrongPct: pct(m.errRate) })),
      calendarSteps: stepAverages(recentCal).sort((a, b) => b.avgMs - a.avgMs).map((x) => ({ name: x.name, avgSec: sec(x.avgMs), n: x.n })),
    },
  };
}

/** 저장소에서 읽어 요약표를 만든다 */
export async function loadCoachSummary(now = Date.now()): Promise<CoachSummary> {
  const cal = CALC_EVENTS.find((e) => e.id === 'calendar')!;
  const [settings, summaries, goals, calLog, stored, rules, mv] = await Promise.all([
    getSettings(),
    loadSummaries(now - 365 * DAY),
    Promise.all([goalFor(1), goalFor(2), goalFor(3)]),
    loadCalcLog(cal.id),
    db.ladderState.get(CALENDAR_LADDER),
    getRules(cal),
    movers(5),
  ]);
  return buildSummary({
    now, dailyMinutes: settings.dailyMinutes, summaries, goals, calLog, calStored: stored?.currentLevel,
    contestSec: Number(rules.timeLimitSec) || 60, slowImages: mv.slowest,
  });
}
