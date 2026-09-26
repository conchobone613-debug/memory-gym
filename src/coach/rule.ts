import { findDiscipline } from '../data/events';
import { CAL_LEVELS } from '../calc/calendarLadder';
import { LADDERS } from '../db/goals';
import { calcLevels } from '../calc/ladders';
import {
  CALC_MIN_ITEMS, calendarOpen, estimate, estimateMs, hasItems, isCalcContest, MAX_COURSE_ITEMS, MAX_ITEMS, MIN_ITEMS, minItems, openMemoryEvents, PREP_MS,
} from './catalog';
import type { CalcEventRecord, CoachSummary, EventRecord } from './summary';
import type { Course, CourseItem, PlannedItem } from './types';

/*
 * 규칙 코치 — AI 가 없을 때(키 없음·실패·꺼짐) 코스를 짠다(기획서 §6.5·§6.6).
 * 기억력이 1순위(시간의 약 2/3) · 사다리 지금 칸에서 · 못 채운 조건을 겨냥 · 오래 안 한 종목 ·
 * 최근 두 판이 기준보다 10%p 이상 낮으면 한 칸 아래를 권한다(자동으로 내리지는 않는다).
 * 스승님 말(say)은 하게체, 이유(why)는 평문. 숫자는 요약표 값 그대로만 쓴다.
 */

/** 코스를 짜는 중의 항목 — 예상 분은 마지막에 붙인다 */
export type Draft = CourseItem & { why: string };
type BasicsItem = Extract<CourseItem, { kind: 'basics' }>;
type CalItem = Extract<CourseItem, { kind: 'calendar' }>;
type CalcItem = Extract<CourseItem, { kind: 'calc' }>;

/** 무너짐: 최근 두 판 정확도가 둘 다 기준보다 이만큼(%p) 이상 낮다 */
export const COLLAPSE_GAP_PCT = 10;
export const collapsed = (last2: number[], needPct: number) =>
  last2.length >= 2 && last2.slice(0, 2).every((a) => a <= needPct - COLLAPSE_GAP_PCT);

const setItems = (i: CourseItem, n: number) => { if (hasItems(i)) i.items = n; };

/** budgetMs 안에 드는 문항 수(10~60, 계산 종목은 5~60) */
function itemsFor(item: CourseItem, budgetMs: number, s: CoachSummary): number {
  const one = { ...item };
  setItems(one, 1);
  const per = estimateMs(one, s) - PREP_MS;
  const n = per > 0 ? Math.floor((budgetMs - PREP_MS) / per) : MAX_ITEMS;
  return Math.min(MAX_ITEMS, Math.max(minItems(item), n));
}

/**
 * 분량을 맞춘다 — 예상 합이 minutes 를 넘으면 가장 긴 드릴부터 5문항씩 줄이고(최소 10),
 * 그래도 넘으면 뒤에서부터 뺀다(하나는 남긴다). 코스는 기억력이 앞이라 계산이 먼저 빠진다.
 */
export function fit(list: Draft[], s: CoachSummary, minutes: number): Draft[] {
  const out = list.map((d) => ({ ...d }));
  const cap = minutes * 60_000;
  const sum = () => out.reduce((a, d) => a + estimateMs(d, s), 0);
  while (sum() > cap) {
    const drills = out.filter((d) => hasItems(d) && d.items > minItems(d));
    if (!drills.length) break;
    const big = drills.reduce((a, b) => (estimateMs(b, s) > estimateMs(a, s) ? b : a));
    if (hasItems(big)) big.items = Math.max(minItems(big), big.items - 5);
  }
  while (sum() > cap && out.length > 1) out.pop();
  return out;
}

const itemKey = (i: CourseItem) =>
  i.kind === 'basics' ? `b${i.stage}` : i.kind === 'calendar' ? `c${i.level}` : i.kind === 'calc' ? `k${i.eventId}${i.level}` : `e${i.eventId}`;

/** 분량이 가진 시간의 이만큼에 못 미치면 채운다 */
export const FILL_RATIO = 0.8;

/**
 * 분량을 채운다 — 스승님은 '무엇을' 고르고 '얼마나' 는 코드가 맞춘다(원칙 2).
 * 실측(2026-09-26): 15분을 청했는데 스승님 코스가 약 5분이었다. 문항 수를 적게 잡는다.
 * ① 드릴 문항을 가장 짧은 것부터 5개씩 늘린다(60까지, 시간을 넘지 않게)
 * ② 그래도 모자라면 extras(같은 시간으로 짠 규칙 코스)에서 겹치지 않는 항목을 덧붙인다(시간 안에 드는 것만, 5개까지).
 */
export function fill(list: Draft[], s: CoachSummary, minutes: number, extras: Draft[]): Draft[] {
  const out = list.map((d) => ({ ...d }));
  const cap = minutes * 60_000;
  const sum = () => out.reduce((a, d) => a + estimateMs(d, s), 0);
  for (;;) {
    if (sum() >= cap * FILL_RATIO) return out;
    const room = out.filter((d) => hasItems(d) && !(d.kind === 'calendar' && d.level === 5) && d.items < MAX_ITEMS);
    const grown = room
      .sort((a, b) => estimateMs(a, s) - estimateMs(b, s))
      .find((d) => {
        const next = { ...d };
        setItems(next, Math.min(MAX_ITEMS, (hasItems(d) ? d.items : 0) + 5));
        return sum() - estimateMs(d, s) + estimateMs(next, s) <= cap;
      });
    if (!grown) break;
    setItems(grown, Math.min(MAX_ITEMS, (hasItems(grown) ? grown.items : 0) + 5));
  }
  const have = new Set(out.map(itemKey));
  for (const x of extras) {
    if (out.length >= MAX_COURSE_ITEMS || sum() >= cap * FILL_RATIO) break;
    if (have.has(itemKey(x)) || sum() + estimateMs(x, s) > cap) continue;
    out.push({ ...x });
    have.add(itemKey(x));
  }
  return out;
}

export const finalize = (list: Draft[], s: CoachSummary): PlannedItem[] => list.map((d) => ({ ...d, estMinutes: estimate(d, s) }));

/** 스승님 답에 이유가 없거나 쓸 수 없을 때 코드가 붙이는 이유 */
export function defaultWhy(item: CourseItem): string {
  if (item.kind === 'basics') return `기초 ${item.stage}단계(${LADDERS[0].levels[item.stage - 1]?.name})를 연습합니다.`;
  if (item.kind === 'calendar') {
    return item.level === 5 ? '1분 모의 대회로 점수를 쌓습니다.' : `달력 ${item.level}칸(${CAL_LEVELS[item.level - 1].name})을 연습합니다.`;
  }
  const name = findDiscipline(item.eventId)?.name ?? item.eventId;
  if (item.kind === 'calc') {
    return isCalcContest(item) ? `${name} 모의 대회로 점수를 쌓습니다.` : `${name} ${item.level}칸(${calcLevels(item.eventId)[item.level - 1].name})에서 연습합니다.`;
  }
  return `${name} 종목을 ${item.run === 'easy' ? '연습합니다' : '모의 대회로 치릅니다'}.`;
}

/** 기초 — 지금 단계(또는 한 칸 아래)와 겨냥할 조건 */
function planBasics(s: CoachSummary): { item: BasicsItem | null; why: string; say: string } {
  const cur = s.basics.current;
  if (cur === 0) {
    return {
      item: { kind: 'basics', stage: 3, items: MIN_ITEMS, pick: 'weak' },
      why: '통과한 단계라 약한 칸만 짧게 복습합니다.',
      say: '기초 세 단계를 모두 통과했으니 오늘은 종목에 힘을 실어 보세.',
    };
  }
  const r = s.basics.stages[cur - 1];
  if (cur === 3 && r.cells === 0) {
    return { item: null, why: '', say: '기초 3단계는 이미지 이름을 채워야 할 수 있으니 오늘은 종목부터 해 보세.' };
  }
  if (cur > 1 && collapsed(r.last2AccuracyPct, r.needAccuracyPct)) {
    const down = (cur - 1) as 1 | 2;
    const [a, b] = r.last2AccuracyPct;
    return {
      item: { kind: 'basics', stage: down, items: MIN_ITEMS },
      why: '최근 두 판 정확도가 기준에 크게 못 미쳐 한 칸 아래에서 다집니다.',
      say: `최근 두 판 정확도가 ${a}%와 ${b}%로 기준 ${r.needAccuracyPct}%에 못 미쳤네. 오늘은 기초 ${down}단계로 한 칸 내려 다져 보세.`,
    };
  }
  const item: BasicsItem = { kind: 'basics', stage: cur, items: MIN_ITEMS };
  const three = (pick: BasicsItem['pick']) => { if (cur === 3) item.pick = pick; };
  if (r.accuracyPct == null) {
    three('unseen');
    return { item, why: '아직 기록이 없는 단계라 처음부터 익힙니다.', say: `기초 ${cur}단계는 아직 기록이 없네. 오늘 처음 길을 터 보세.` };
  }
  if (r.cellsDone < r.cells) {
    three(r.unseen > 0 ? 'unseen' : 'srs');
    return {
      item,
      why: r.unseen > 0 ? `아직 안 본 칸이 ${r.unseen}칸 남았습니다.` : `${r.cells}칸 중 ${r.cellsDone}칸만 ${r.needReps}번 이상 봤습니다.`,
      say: `기초 ${cur}단계는 ${r.cells}칸 중 ${r.cellsDone}칸을 ${r.needReps}번 이상 봤네. 남은 칸을 채워 보세.`,
    };
  }
  if (r.accuracyPct < r.needAccuracyPct) {
    three('weak');
    return {
      item,
      why: `정확도 ${r.accuracyPct}%를 ${r.needAccuracyPct}%까지 올려야 합니다.`,
      say: `기초 ${cur}단계 정확도가 지금 ${r.accuracyPct}%일세. 기준 ${r.needAccuracyPct}%까지 끌어올려 보세.`,
    };
  }
  three('srs');
  if (r.medianSec == null) return { item, why: '반응시간 기록을 쌓아야 합니다.', say: `기초 ${cur}단계를 이어서 해 보세.` };
  return {
    item,
    why: `중앙 반응 ${r.medianSec}초를 ${r.needSec}초 안으로 줄여야 합니다.`,
    say: `기초 ${cur}단계 중앙 반응이 ${r.medianSec}초일세. ${r.needSec}초 안으로 당겨 보세.`,
  };
}

/** 달력 — 지금 칸(또는 한 칸 아래)과 겨냥할 조건 */
function planCalendar(s: CoachSummary): { item: CalItem; why: string } | null {
  if (!calendarOpen()) return null;
  const c = s.calendar;
  if (c.current >= 5) {
    return {
      item: { kind: 'calendar', level: 5, items: 0 },
      why: c.levels.every((l) => l.passed) ? '사다리 네 칸을 모두 통과해 1분 모의 대회로 점수를 쌓습니다.' : '지금 칸으로 정한 1분 모의 대회입니다.',
    };
  }
  const cur = c.current as 1 | 2 | 3 | 4;
  const r = c.levels[cur - 1];
  if (cur > 1 && collapsed(r.last2AccuracyPct, r.needAccuracyPct)) {
    return {
      item: { kind: 'calendar', level: (cur - 1) as 1 | 2 | 3, items: MIN_ITEMS },
      why: '최근 두 판 정확도가 기준에 크게 못 미쳐 한 칸 아래에서 다집니다.',
    };
  }
  const item: CalItem = { kind: 'calendar', level: cur, items: MIN_ITEMS };
  const tag = `달력 ${cur}칸(${r.name})`;
  if (r.accuracyPct == null) return { item, why: `${tag}은 아직 기록이 없어 처음부터 합니다.` };
  if (r.recentItems < r.needItems) return { item, why: `${tag}은 최근 문항이 ${r.recentItems}개라 ${r.needItems}개까지 쌓아야 합니다.` };
  if (r.accuracyPct < r.needAccuracyPct) {
    /* 날짜 전체 칸에서 정확도가 모자라면 단계 입력으로 어느 단계에서 틀리는지 가른다 */
    if (cur >= 3) item.steps = true;
    return { item, why: `${tag} 정확도 ${r.accuracyPct}%를 ${r.needAccuracyPct}%까지 올려야 합니다.` };
  }
  if (r.medianSec != null && r.medianSec > r.needSec) {
    return { item, why: `${tag} 중앙 반응 ${r.medianSec}초를 ${r.needSec}초 안으로 줄여야 합니다.` };
  }
  return { item, why: `${tag}에서 다지는 중입니다.` };
}

/** 계산 종목(달력 제외) — 지금 칸(또는 한 칸 아래)과 겨냥할 조건. 지금 칸이 모의 대회면 모의 대회 */
function planCalc(e: CalcEventRecord): { item: CalcItem; why: string } {
  const last = calcLevels(e.id).at(-1)!.n;
  if (e.current >= last) {
    return {
      item: { kind: 'calc', eventId: e.id, level: last, items: 0 },
      why: e.levels.every((l) => l.passed) ? `${e.name} 연습 칸을 모두 통과해 모의 대회로 점수를 쌓습니다.` : `지금 칸으로 정한 ${e.name} 모의 대회입니다.`,
    };
  }
  const cur = e.current;
  const r = e.levels[cur - 1];
  if (cur > 1 && collapsed(r.last2AccuracyPct, r.needAccuracyPct)) {
    return {
      item: { kind: 'calc', eventId: e.id, level: cur - 1, items: CALC_MIN_ITEMS },
      why: '최근 두 판 정확도가 기준에 크게 못 미쳐 한 칸 아래에서 다집니다.',
    };
  }
  const item: CalcItem = { kind: 'calc', eventId: e.id, level: cur, items: CALC_MIN_ITEMS };
  const tag = `${e.name} ${cur}칸(${r.name})`;
  if (r.accuracyPct == null) return { item, why: `${tag}에 아직 기록이 없어 처음부터 합니다.` };
  if (r.recentItems < r.needItems) return { item, why: `${tag}에 최근 문항이 ${r.recentItems}개라 ${r.needItems}개까지 쌓아야 합니다.` };
  if (r.accuracyPct < r.needAccuracyPct) return { item, why: `${tag} 정확도 ${r.accuracyPct}%를 ${r.needAccuracyPct}%까지 올려야 합니다.` };
  if (r.medianSec != null && r.medianSec > r.needSec) {
    return { item, why: `${tag} 중앙 반응 ${r.medianSec}초를 ${r.needSec}초 안으로 줄여야 합니다.` };
  }
  return { item, why: `${tag}에서 다지는 중입니다.` };
}

/** 한 번도 안 한 것(등록부 순) → 오래 쉰 것 순 */
const byRest = (a: { runs: number; daysAgo: number | null }, b: { runs: number; daysAgo: number | null }) =>
  Number(b.runs === 0) - Number(a.runs === 0) || (b.daysAgo ?? 0) - (a.daysAgo ?? 0);

const eventOrder = (s: CoachSummary) => [...s.events].sort(byRest);

/**
 * 계산 몫을 받을 종목 — 달력과 열린 계산 종목 가운데 기억력 종목과 같은 순서(byRest)로 하나.
 * 최소 분량으로도 room(기억력 항목을 최소로 줄이고 남는 시간)에 안 드는 종목은 건너뛴다 — 골라 봐야 fit 이 빼서
 * 계산 몫이 통째로 비고, 그 종목이 계속 '오래 쉰 종목'으로 남아 다음 종목까지 밀린다. 어느 것도 안 들면 첫 종목(fit 이 뺀다).
 */
function planCalcShare(s: CoachSummary, room: number): { item: CalItem | CalcItem; why: string } | null {
  const picks = [
    ...(calendarOpen() ? [{ runs: s.calendar.runs, daysAgo: s.calendar.daysAgo, plan: () => planCalendar(s) }] : []),
    ...s.calcEvents.map((e) => ({ runs: e.runs, daysAgo: e.daysAgo, plan: () => planCalc(e) })),
  ];
  const plans = picks.sort(byRest).map((p) => p.plan()).filter((p) => p !== null);
  const least = (i: CourseItem) => estimateMs(hasItems(i) ? { ...i, items: minItems(i) } : i, s);
  return plans.find((p) => least(p.item) <= room) ?? plans[0] ?? null;
}

/** 연습을 90% 넘게 하면 모의 대회로, 모의 대회가 80% 밑이면 다시 연습으로 */
const runFor = (e: EventRecord): 'easy' | 'real' =>
  (e.lastRun === 'easy' && (e.lastAccuracyPct ?? 0) >= 90) || (e.lastRun === 'real' && (e.lastAccuracyPct ?? 0) >= 80) ? 'real' : 'easy';

function eventWhy(e: EventRecord, run: 'easy' | 'real'): string {
  if (e.runs === 0) return '아직 한 번도 하지 않은 종목입니다.';
  if ((e.daysAgo ?? 0) >= 2) return `마지막으로 한 지 ${e.daysAgo}일 된 종목입니다.`;
  return run === 'real' ? `지난 판 정확도 ${e.lastAccuracyPct}%라 규격대로 겨뤄 봅니다.` : `지난 판 정확도 ${e.lastAccuracyPct}%에서 이어 갑니다.`;
}

export function ruleCourse(s: CoachSummary, minutes: number): Course {
  const total = minutes * 60_000;
  const memBudget = (total * 2) / 3;
  const b = planBasics(s);

  /* 기억력 종목을 먼저 고른다(판이 커서) — 기초 드릴 최소 분량은 남겨 둔다 */
  let left = memBudget - (b.item ? estimateMs(b.item, s) : 0);
  const events: Draft[] = [];
  const open = new Set(openMemoryEvents().map((e) => e.id));
  for (const e of eventOrder(s)) {
    if (events.length >= 2) break;
    if (!open.has(e.id)) continue;
    let run = runFor(e);
    if (run === 'real' && estimateMs({ kind: 'event', eventId: e.id, run }, s) > left) run = 'easy';
    const est = estimateMs({ kind: 'event', eventId: e.id, run }, s);
    if (est > left) continue;
    events.push({ kind: 'event', eventId: e.id, run, why: eventWhy(e, run) });
    left -= est;
  }
  const eventsMs = events.reduce((a, d) => a + estimateMs(d, s), 0);

  const drafts: Draft[] = [];
  if (b.item) drafts.push({ ...b.item, items: itemsFor(b.item, memBudget - eventsMs, s), why: b.why });
  drafts.push(...events);
  const c = planCalcShare(s, total - (b.item ? estimateMs(b.item, s) : 0) - eventsMs);
  if (c) {
    const item = { ...c.item };
    if (hasItems(item)) item.items = itemsFor(item, total - memBudget, s);
    drafts.push({ ...item, why: c.why });
  }
  return { say: b.say, items: finalize(fit(drafts, s, minutes), s) };
}
