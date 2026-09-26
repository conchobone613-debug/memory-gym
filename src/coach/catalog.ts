import { CALC_EVENTS, findDiscipline, MEMORY_EVENTS, type CalcEvent, type MemoryEvent } from '../data/events';
import { PRESETS } from '../data/presets';
import { LADDERS } from '../db/goals';
import { CAL_LEVELS } from '../calc/calendarLadder';
import { calcLevels, isContestLevel, sessionType } from '../calc/ladders';
import { defaultRules } from '../lib/rules';
import type { CourseItem } from './types';
import type { CoachSummary } from './summary';

/*
 * 코스 항목 카탈로그 — 코스에 오를 수 있는 것은 여기 있는 것뿐이다(열린 종목만, status 'ready').
 * 항목마다 예상 시간과 화면 주소를 코드가 만든다. 스승님이 적은 숫자는 쓰지 않는다.
 */

/** 드릴 한 항목의 문항 수 범위 */
export const MIN_ITEMS = 10;
export const MAX_ITEMS = 60;
/** 코스 한 벌의 항목 수 상한 */
export const MAX_COURSE_ITEMS = 5;
/** 준비 여유 — 설정·카운트다운·결과 화면을 읽는 시간 */
export const PREP_MS = 30_000;

/** 기록이 없을 때 한 문항에 드는 시간(ms) — 스승님 글(prompts.ts)도 이 값을 옮겨 적는다 */
export const BASICS_MS: Record<1 | 2 | 3, number> = { 1: 1500, 2: 3000, 3: 4000 };
export const CALENDAR_MS: Record<1 | 2 | 3 | 4, number> = { 1: 4000, 2: 2000, 3: 12_000, 4: 12_000 };

/** 계산 종목 칸의 최소 문항 수 — 한 문항이 30~90초라 기초·달력의 MIN_ITEMS 로는 코스에 들지 못한다 */
export const CALC_MIN_ITEMS = 5;
export const minItems = (i: CourseItem) => (i.kind === 'calc' ? CALC_MIN_ITEMS : MIN_ITEMS);

export const openMemoryEvents = (): MemoryEvent[] => MEMORY_EVENTS.filter((e) => e.status === 'ready');
export const calendarOpen = () => CALC_EVENTS.some((e) => e.id === 'calendar' && e.status === 'ready');
/** 코스에 오를 수 있는 계산 종목(달력 제외) — 열렸고 사다리가 있는 것 */
export const openCalcEvents = (): CalcEvent[] =>
  CALC_EVENTS.filter((e) => e.status === 'ready' && e.id !== 'calendar' && calcLevels(e.id).length > 0);

/** 계산 종목 항목이 모의 대회 칸인가(없는 칸도 문항 수가 없는 쪽으로) */
export const isCalcContest = (i: Extract<CourseItem, { kind: 'calc' }>) => {
  const lv = calcLevels(i.eventId)[i.level - 1];
  return !lv || isContestLevel(lv);
};

/** 종목 화면 주소(?preset=)가 가리키는 프리셋 */
export function presetOf(eventId: string) {
  const to = findDiscipline(eventId)?.to ?? '';
  const id = new URLSearchParams(to.split('?')[1] ?? '').get('preset');
  return PRESETS.find((p) => p.id === id);
}

/** 문항 수가 있는 항목(기초·달력 1~4칸·계산 종목 연습 칸) */
export const hasItems = (i: CourseItem): i is Extract<CourseItem, { items: number }> =>
  i.kind === 'basics' || (i.kind === 'calendar' && i.level < 5) || (i.kind === 'calc' && !isCalcContest(i));

/** 계산 종목 모의 대회 규정(요약표에 없으면 등록부 기본값) */
function calcContestRule(s: CoachSummary, eventId: string): { limitSec: number; items: number } {
  const rec = s.calcEvents?.find((e) => e.id === eventId);
  if (rec) return { limitSec: rec.contest.limitSec, items: rec.contest.items };
  const ev = CALC_EVENTS.find((e) => e.id === eventId);
  const r = ev ? defaultRules(ev.rules) : {};
  return { limitSec: Number(r.timeLimitSec) || 0, items: Number(r.items) || 0 };
}

/**
 * 예상 시간(ms) = 같은 칸의 최근 '한 문항에 실제로 든 시간' 중앙값 × 문항 수 + 준비 여유.
 * 기록이 없으면 기본값. 기억력 종목은 최근 판 걸린 시간 중앙값, 없으면 프리셋 암기+회상(연습은 1/4).
 */
export function estimateMs(item: CourseItem, s: CoachSummary): number {
  if (item.kind === 'basics') {
    const pace = s.basics.stages[item.stage - 1]?.paceSec;
    return PREP_MS + item.items * (pace ? pace * 1000 : BASICS_MS[item.stage]);
  }
  if (item.kind === 'calendar') {
    if (item.level === 5) return PREP_MS + s.calendar.contest.limitSec * 1000;
    const pace = s.calendar.levels[item.level - 1]?.paceSec;
    return PREP_MS + item.items * (pace ? pace * 1000 : CALENDAR_MS[item.level]);
  }
  if (item.kind === 'calc') {
    const levels = calcLevels(item.eventId);
    if (isCalcContest(item)) {
      /* 제한시간이 있으면 그 시간, 없으면(끝까지 풀고 시간만 잼) 규정 문항 × 마지막 연습 칸의 한 문항 시간 */
      const c = calcContestRule(s, item.eventId);
      const per = levels.filter((l) => !isContestLevel(l)).at(-1)?.perItemMs ?? 0;
      return PREP_MS + (c.limitSec > 0 ? c.limitSec * 1000 : c.items * per);
    }
    const pace = s.calcEvents?.find((e) => e.id === item.eventId)?.levels[item.level - 1]?.paceSec;
    return PREP_MS + item.items * (pace ? pace * 1000 : levels[item.level - 1].perItemMs);
  }
  const rec = s.events.find((e) => e.id === item.eventId);
  const past = item.run === 'easy' ? rec?.easyMin : rec?.realMin;
  if (past) return PREP_MS + past * 60_000;
  const p = presetOf(item.eventId);
  const full = p ? (p.memorizeSec + p.recallSec) * 1000 : 10 * 60_000;
  return PREP_MS + (item.run === 'easy' ? full / 4 : full);
}

/** 예상 분(정수, 최소 1) — 화면에 적는 값 */
export const estimate = (item: CourseItem, s: CoachSummary) => Math.max(1, Math.round(estimateMs(item, s) / 60_000));

/**
 * 항목 → 화면 주소. 코스로 여는 판이면 '&course=<행 id>&ci=<순번>' 을 붙인다 — 그 판이 끝나면 markStep 으로 표시한다.
 * 기초 '/basics?stage=S&n=N(&pick=P)' · 달력 '/calc/calendar/run?level=L&n=N(&steps=1)' 또는 '?mode=contest' ·
 * 계산 종목 '/calc/<id>/run?level=L&n=N' 또는 '?mode=contest' · 종목 = 등록부의 to + '&run=R'.
 */
export function courseHref(item: CourseItem, logId?: string, index = 0): string {
  let base: string;
  if (item.kind === 'basics') {
    base = `/basics?stage=${item.stage}&n=${item.items}${item.stage === 3 && item.pick ? `&pick=${item.pick}` : ''}`;
  } else if (item.kind === 'calendar') {
    base = item.level === 5
      ? '/calc/calendar/run?mode=contest'
      : `/calc/calendar/run?level=${item.level}&n=${item.items}${item.steps ? '&steps=1' : ''}`;
  } else if (item.kind === 'calc') {
    base = `/calc/${item.eventId}/run?${isCalcContest(item) ? 'mode=contest' : `level=${item.level}&n=${item.items}`}`;
  } else {
    const to = findDiscipline(item.eventId)?.to ?? '/memory';
    base = `${to}${to.includes('?') ? '&' : '?'}run=${item.run}`;
  }
  return logId ? `${base}&course=${encodeURIComponent(logId)}&ci=${index}` : base;
}

/** 실제로 한 판의 모양 — 코스 항목과 견줘 그 항목을 마쳤는지 가린다 */
export type PlayedRun =
  | { kind: 'basics'; stage: number }
  | { kind: 'calendar'; level: number; steps: boolean }
  | { kind: 'event'; presetId: string | null; run: 'easy' | 'real' }
  /**
   * 계산 종목(달력 제외). 모의 대회는 마지막 칸 번호. flash = 플래시 암산 판, type = 유형 하나만 고른 판(서프라이즈 —
   * 섞기 'mix' 나 없음은 섞기 판). 둘 다 사다리에 들지 않는다
   */
  | { kind: 'calc'; eventId: string; level: number; flash?: boolean; type?: string };

/**
 * 이 판이 코스 항목대로였는가 — 다른 단계·칸·단계 입력·프리셋·모드로 한 판은 그 항목을 마친 것으로 치지 않는다.
 * 계산 종목 항목은 사다리 연습이므로 플래시 판·유형 한정 판도 치지 않는다.
 */
export function playedMatches(item: CourseItem, p: PlayedRun): boolean {
  if (item.kind === 'basics') return p.kind === 'basics' && p.stage === item.stage;
  if (item.kind === 'calendar') {
    return p.kind === 'calendar' && p.level === item.level && (item.level === 5 || p.steps === !!item.steps);
  }
  if (item.kind === 'calc') {
    return p.kind === 'calc' && p.eventId === item.eventId && p.level === item.level && !p.flash && !sessionType(p);
  }
  return p.kind === 'event' && p.run === item.run && p.presetId === (presetOf(item.eventId)?.id ?? null);
}

/** 주소에서 코스 진행 표시를 읽는다(없으면 null) — 판이 끝나면 markStep(logId, index, 세션 id) */
export function courseStep(params: URLSearchParams): { logId: string; index: number } | null {
  const logId = params.get('course');
  const index = Number(params.get('ci'));
  return logId && Number.isInteger(index) && index >= 0 ? { logId, index } : null;
}

const PICK_NAME = { srs: '골고루', weak: '약한 칸', unseen: '안 본 칸', all: '전부' } as const;

/**
 * 항목 이름(평문) — '기초 2단계 · 두 자리 · 30문항', '달력 5칸 · 1분 모의 대회', '스피드 숫자 · 연습',
 * '제곱근 2칸 · 6자리 · 유효 6 · 20문항', '제곱근 · 모의 대회'
 */
export function itemLabel(item: CourseItem): string {
  if (item.kind === 'calc') {
    const name = findDiscipline(item.eventId)?.name ?? item.eventId;
    if (isCalcContest(item)) return `${name} · 모의 대회`;
    return `${name} ${item.level}칸 · ${calcLevels(item.eventId)[item.level - 1].name} · ${item.items}문항`;
  }
  if (item.kind === 'basics') {
    const name = LADDERS[0].levels[item.stage - 1]?.name ?? '';
    const pick = item.stage === 3 && item.pick ? ` · ${PICK_NAME[item.pick]}` : '';
    return `기초 ${item.stage}단계 · ${name} · ${item.items}문항${pick}`;
  }
  if (item.kind === 'calendar') {
    const lv = CAL_LEVELS[item.level - 1];
    if (item.level === 5) return `달력 5칸 · ${lv.name}`;
    return `달력 ${item.level}칸 · ${lv.name} · ${item.items}문항${item.steps ? ' · 단계 입력' : ''}`;
  }
  const name = findDiscipline(item.eventId)?.name ?? item.eventId;
  return `${name} · ${item.run === 'easy' ? '연습' : '모의 대회'}`;
}
