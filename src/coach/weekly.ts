import { getSettings, type CoachLog } from '../db/db';
import { localDayKey } from '../db/analytics';
import { dayStreak, loadSummaries, type SessionSummary } from '../db/sessions';
import { disciplineName, disciplineOrder, loadWeakness, scoreUnit, type Weakness } from '../db/insights';
import { DOMAIN_NAME, type Domain } from '../data/events';
import { median } from '../lib/srs';

/*
 * 스승님 주간 리뷰의 입력 — 이번 주(오늘 포함 최근 7일)와 지난주(그 앞 7일)를 견준 작고 사실만 담은 표.
 * 요약표(summary.ts)처럼 사람이 읽는 단위로 두고, 스승님 답의 숫자는 이 표에 있는 값만 받는다(validate.ts). 신원 정보는 넣지 않는다.
 */

export type DomainLabel = (typeof DOMAIN_NAME)[Domain];

export interface WeeklyDomain {
  /** 훈련한 분(정수) */
  minutes: number;
  prevMinutes: number;
  sessions: number;
  prevSessions: number;
}

export interface WeeklyDiscipline {
  name: string;
  domain: DomainLabel;
  sessions: number;
  prevSessions: number;
  /** 그 주 전체 문항의 정확도(%). 판이 없으면 null */
  accuracyPct: number | null;
  prevAccuracyPct: number | null;
  /** 이번 주 문항당 반응 중앙값(초) */
  secPerItem: number | null;
  /** 점수가 있는 종목의 모의 대회 최고 점수 */
  bestContest: number | null;
  prevBestContest: number | null;
  /** 모의 대회 점수의 단위('점' · '자리') — 점수가 있을 때만 */
  contestUnit?: string;
}

export interface WeeklyWeak {
  area: DomainLabel;
  /** '느린 이미지' · '오답 원인' · '달력 느린 단계' · '낮은 정확도' */
  what: string;
  name: string;
  /** 표본 수 */
  n: number;
  sec?: number;
  accuracyPct?: number;
}

export interface WeeklyInput {
  /** 이번 주 첫날과 오늘(YYYY-MM-DD) */
  week: { from: string; to: string };
  /** daysMetGoal = 이번 주 하루 목표(goalMin 분)를 채운 날 수 */
  daily: { goalMin: number; daysMetGoal: number; streak: number };
  domains: { memory: WeeklyDomain; calc: WeeklyDomain };
  /** 이번 주나 지난주에 판이 있는 종목만, 등록부 순서 */
  disciplines: WeeklyDiscipline[];
  weak: WeeklyWeak[];
  /** 읽은 기록에 판이 하나라도 있는가 — 두 주 동안 판이 없을 때 '아직 기록이 없네' 와 가르려고 */
  everPlayed: boolean;
}

const pct = (x: number) => Math.round(x * 100);
const sec = (ms: number) => Math.round(ms / 10) / 100;
const sum = (xs: SessionSummary[], f: (s: SessionSummary) => number) => xs.reduce((a, s) => a + f(s), 0);

/** 이번 주 = [from, to) — 오늘 포함 최근 7일(현지 자정 기준). 지난주 = [prevFrom, from) */
export function weekRange(now = Date.now()): { prevFrom: number; from: number; to: number } {
  const to = new Date(now);
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 1);
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - 7);
  return { prevFrom: prevFrom.getTime(), from: from.getTime(), to: to.getTime() };
}

/** 이번 주에 받은 주간 리뷰인가 — 화면 자판 글자('다시 받기') */
export function receivedThisWeek(row: Pick<CoachLog, 'at'> | undefined, now = Date.now()): boolean {
  const r = weekRange(now);
  return !!row && row.at >= r.from && row.at < r.to;
}

function domainOf(cur: SessionSummary[], prev: SessionSummary[], d: Domain): WeeklyDomain {
  const c = cur.filter((s) => s.domain === d);
  const p = prev.filter((s) => s.domain === d);
  return {
    minutes: Math.round(sum(c, (s) => s.durationMs) / 60_000), prevMinutes: Math.round(sum(p, (s) => s.durationMs) / 60_000),
    sessions: c.length, prevSessions: p.length,
  };
}

const accuracyOf = (xs: SessionSummary[]) => {
  const items = sum(xs, (s) => s.items);
  return items ? pct(sum(xs, (s) => s.correct) / items) : null;
};

const bestOf = (xs: SessionSummary[]) => {
  const scores = xs.filter((s) => s.mode === 'contest' && s.score !== undefined).map((s) => s.score!);
  return scores.length ? Math.max(...scores) : null;
};

function flatWeak(w: Weakness): WeeklyWeak[] {
  const [slowStep] = w.calc.calendarSteps;
  return [
    ...w.memory.slowImages.map((x) => ({ area: DOMAIN_NAME.memory, what: '느린 이미지', name: `${x.key} ${x.name}`, n: x.n, sec: x.sec })),
    ...w.memory.errorTags.map((x) => ({ area: DOMAIN_NAME.memory, what: '오답 원인', name: x.name, n: x.n })),
    ...(slowStep ? [{ area: DOMAIN_NAME.calc, what: '달력 느린 단계', name: slowStep.name, n: slowStep.n, sec: slowStep.sec }] : []),
    ...w.calc.lowAccuracy.map((x) => ({ area: DOMAIN_NAME.calc, what: '낮은 정확도', name: x.name, n: x.n, accuracyPct: x.accuracyPct })),
  ];
}

/** 순수 함수 — 통합 기록(summaries)·하루 목표(분)·약점 요약에서 주간 표를 만든다 */
export function buildWeeklyInput(summaries: SessionSummary[], now: number, dailyMinutes: number, weak: Weakness): WeeklyInput {
  const r = weekRange(now);
  const cur = summaries.filter((s) => s.startedAt >= r.from && s.startedAt < r.to);
  const prev = summaries.filter((s) => s.startedAt >= r.prevFrom && s.startedAt < r.from);

  const perDay = new Map<string, number>();
  for (const s of cur) perDay.set(localDayKey(s.startedAt), (perDay.get(localDayKey(s.startedAt)) ?? 0) + s.durationMs);
  const daysMetGoal = [...perDay.values()].filter((ms) => ms > 0 && ms >= dailyMinutes * 60_000).length;

  const ids = [...new Set([...cur, ...prev].map((s) => s.disciplineId))]
    .sort((a, b) => disciplineOrder(a) - disciplineOrder(b) || a.localeCompare(b));
  const disciplines = ids.map((id): WeeklyDiscipline => {
    const c = cur.filter((s) => s.disciplineId === id);
    const p = prev.filter((s) => s.disciplineId === id);
    const any = c[0] ?? p[0];
    const rts = c.map((s) => s.perItemMs).filter((x) => x > 0);
    const bestContest = bestOf(c);
    const prevBestContest = bestOf(p);
    const unit = scoreUnit(id, any.domain);
    return {
      name: disciplineName(id, any.title), domain: DOMAIN_NAME[any.domain],
      sessions: c.length, prevSessions: p.length,
      accuracyPct: accuracyOf(c), prevAccuracyPct: accuracyOf(p),
      secPerItem: rts.length ? sec(median(rts)) : null,
      bestContest, prevBestContest,
      ...(unit && (bestContest != null || prevBestContest != null) ? { contestUnit: unit } : {}),
    };
  });

  return {
    week: { from: localDayKey(r.from), to: localDayKey(now) },
    daily: { goalMin: dailyMinutes, daysMetGoal, streak: dayStreak(summaries, now).streak },
    domains: { memory: domainOf(cur, prev, 'memory'), calc: domainOf(cur, prev, 'calc') },
    disciplines,
    weak: flatWeak(weak),
    everPlayed: summaries.length > 0,
  };
}

/** 저장소에서 읽어 주간 표를 만든다 — 연속일을 세려고 한 해 치 기록을 읽는다 */
export async function loadWeeklyInput(now = Date.now()): Promise<WeeklyInput> {
  const [settings, summaries, weak] = await Promise.all([getSettings(), loadSummaries(now - 365 * 86_400_000), loadWeakness(now)]);
  return buildWeeklyInput(summaries, now, settings.dailyMinutes, weak);
}

/**
 * 규칙으로 쓴 주간 요약 — 키가 없거나 아직 스승님께 받지 않았을 때. 하게체 두 문장.
 * 숫자는 표에 있는 값만 쓴다. 지난주와 견줄 때 차이(뺀 값)는 새 숫자라 쓰지 않고 늘었·줄었만 말한다.
 */
export function ruleWeekly(inp: WeeklyInput): string {
  const { memory: m, calc: c } = inp.domains;
  if (!m.sessions && !c.sessions) {
    if (m.prevSessions || c.prevSessions) return '이번 주에는 아직 기록이 없네. 오늘 한 판부터 다시 시작해 보세.';
    return inp.everPlayed ? '요즘 두 주 동안은 기록이 없네. 오늘 한 판부터 다시 시작해 보세.' : '아직 기록이 없네. 오늘 한 판부터 시작해 보세.';
  }

  /* 늘고 줄음은 문장에 적은 영역끼리만 견준다 — 안 적은 영역의 지난주 분이 섞이면 반대로 읽힌다 */
  const shown = (['memory', 'calc'] as const).map((k) => ({ name: DOMAIN_NAME[k], ...inp.domains[k] })).filter((d) => d.sessions);
  const parts = shown.map((d) => `${d.name} ${d.minutes}분`).join(' · ');
  const now = shown.reduce((a, d) => a + d.minutes, 0);
  const before = shown.reduce((a, d) => a + d.prevMinutes, 0);
  const prev = shown.reduce((a, d) => a + d.prevSessions, 0);
  const tail = !prev ? '을 채웠네.' : now > before ? ', 지난주보다 늘었네.' : now < before ? ', 지난주보다 줄었네.' : ', 지난주와 같네.';
  const g = inp.daily;
  const goal = g.daysMetGoal ? `하루 목표 ${g.goalMin}분을 ${g.daysMetGoal}일 채웠네.` : `하루 목표 ${g.goalMin}분을 채운 날은 아직 없네.`;
  return `이번 주 ${parts}${tail} ${goal}`;
}
