import { CALC_EVENTS, findDiscipline } from '../data/events';
import { calcLevels } from '../calc/ladders';
import {
  CALC_MIN_ITEMS, calendarOpen, estimateMs, isCalcContest, MAX_COURSE_ITEMS, MAX_ITEMS, MIN_ITEMS, openCalcEvents, openMemoryEvents,
} from './catalog';
import { courseUser, reviewUser, weeklyUser } from './prompts';
import { defaultWhy, fill, finalize, fit, ruleCourse, type Draft } from './rule';
import type { CoachSummary } from './summary';
import type { ReviewInput } from './review';
import type { Course, CourseItem, Review, WeeklyReview } from './types';
import type { WeeklyInput } from './weekly';
import type { PickMode } from '../db/db';

/*
 * 스승님 답 검사 — 이름 후보의 keep() 과 같은 자리(기획서 §6.3). 형식이 스키마대로 와도 값은 틀릴 수 있다.
 * 등록부에 없는 종목·잠긴 종목은 버리고, 범위 밖 값은 고친다. 남은 항목이 없으면 null → 규칙 코치.
 * 말에 **보낸 글에 없는 숫자**가 섞인 문장은 뺀다 — 숫자는 코드가 계산한 실제 값만(원칙 2). 말투도 다시 본다.
 */

/** 스승님 말이 전부 빠졌을 때 */
export const SAFE_SAY = '오늘 코스를 차례로 해 보세.';
const DEFAULT_ITEMS = 20;
const PICKS: PickMode[] = ['srs', 'weak', 'unseen', 'all'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);

export const numbersIn = (text: string): number[] => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/*
 * 숫자 검사는 단위까지 맞춘다 — 'N%' 는 요약의 *Pct 값, 'N초' 는 *Sec 값, 'N분' 은 *Min·*minutes 값과 보낸 글에
 * 'N분' 으로 적힌 값(가진 시간·종목 예상 분), 'N일' 은 days*(daysAgo·daysMetGoal)·streak. '%p' 는 늘 버린다(요약에는 차이 값이 없다 —
 * 붙었다면 스승님이 직접 뺀 것). 그 밖의 숫자(단계·칸·문항 수 등)는 보낸 글에 있는 숫자면 받는다.
 */
type Unit = '%' | '초' | '분' | '일';
export interface Allowed { any: Set<number>; unit: Record<Unit, Set<number>> }
/* '일세'(…일세) 의 '일' 은 날 수가 아니다 */
const NUM_UNIT = /(\d+(?:\.\d+)?)\s*(%p|%|초|분|일(?!세))?/g;
const unitOfKey = (k: string): Unit | null =>
  /pct$/i.test(k) ? '%' : /sec/i.test(k) ? '초' : /min$|minutes$/i.test(k) ? '분' : /^days/.test(k) || k === 'streak' ? '일' : null;

/** 보낸 글(text)과 그 안의 요약(data)에서 받아 줄 숫자 */
export function allowedIn(text: string, data: unknown): Allowed {
  const unit: Allowed['unit'] = { '%': new Set(), 초: new Set(), 분: new Set(), 일: new Set() };
  const walk = (v: unknown, k: string) => {
    if (typeof v === 'number') { const u = unitOfKey(k); if (u) unit[u].add(v); }
    /* 날짜('2026-09-24')의 날 — '24일' 로 말해도 실제 값이다 */
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) unit['일'].add(Number(v.slice(8)));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (isObj(v)) Object.entries(v).forEach(([kk, x]) => walk(x, kk));
  };
  walk(data, '');
  for (const m of text.matchAll(NUM_UNIT)) if (m[2] && m[2] !== '%p') unit[m[2] as Unit].add(Number(m[1]));
  return { any: new Set(numbersIn(text)), unit };
}

export const numbersOk = (text: string, a: Allowed) =>
  [...text.matchAll(NUM_UNIT)].every((m) => m[2] !== '%p' && (m[2] ? a.unit[m[2] as Unit] : a.any).has(Number(m[1])));

/* 말투 — why·next 는 평문(…습니다), say 는 하게체. 프롬프트의 예시에만 기대지 않고 코드가 다시 본다 */
const PLAIN_END = /니다[.!]?$/;
/** 스승님 말에 올 수 없는 끝 — 합쇼체·해요체('…합니다', '…봅시다', '…하세요') */
const NOT_SAGE_END = /(니다|니까|시오|시다|요)[.!?]?$/;
const plain = (t: string) => PLAIN_END.test(t);

/** 문장마다 숫자·말투를 검사해 통과한 문장만 남긴다. drop 에 걸린 문장도 뺀다 */
export function keepSentences(text: string, allowed: Allowed, drop: (sentence: string) => boolean = () => false): string {
  return oneLine(text).split(/(?<=[.!?])\s+/)
    .filter((x) => x && numbersOk(x, allowed) && !NOT_SAGE_END.test(x) && !drop(x)).join(' ');
}

const clampItems = (v: unknown, min = MIN_ITEMS) => {
  const n = int(v);
  return n > 0 ? Math.min(MAX_ITEMS, Math.max(min, n)) : DEFAULT_ITEMS;
};

/** 항목 하나를 카탈로그에 맞춘다. 쓸 수 없으면 null */
function cleanItem(r: Record<string, unknown>, s: CoachSummary): CourseItem | null {
  if (r.kind === 'basics') {
    const st = int(r.stage);
    if (!(st >= 1 && st <= 3)) return null;
    /* 사다리는 지금 칸에서 한 칸 위까지만 */
    const stage = Math.min(st, (s.basics.current || 3) + 1) as 1 | 2 | 3;
    if (stage === 3 && !s.basics.stages[2]?.cells) return null;
    const pick = stage === 3 && PICKS.includes(r.pick as PickMode) ? (r.pick as PickMode) : undefined;
    return { kind: 'basics', stage, items: clampItems(r.items), ...(pick ? { pick } : {}) };
  }
  if (r.kind === 'calendar') {
    const lv = int(r.level);
    if (!calendarOpen() || !(lv >= 1 && lv <= 5)) return null;
    const level = Math.min(lv, s.calendar.current + 1) as 1 | 2 | 3 | 4 | 5;
    if (level === 5) return { kind: 'calendar', level, items: 0 };
    const steps = (level === 3 || level === 4) && r.steps === true;
    return { kind: 'calendar', level, items: clampItems(r.items), ...(steps ? { steps } : {}) };
  }
  if (r.kind === 'event') {
    const ev = openMemoryEvents().find((e) => e.id === r.eventId);
    if (!ev) return null;
    return { kind: 'event', eventId: ev.id, run: r.run === 'real' ? 'real' : 'easy' };
  }
  if (r.kind === 'calc') {
    const ev = openCalcEvents().find((e) => e.id === r.eventId);
    const lv = int(r.level);
    const last = ev ? calcLevels(ev.id).length : 0;
    if (!ev || !(lv >= 1 && lv <= last)) return null;
    const level = Math.min(lv, (s.calcEvents.find((e) => e.id === ev.id)?.current ?? 1) + 1);
    const item: CourseItem = { kind: 'calc', eventId: ev.id, level, items: 0 };
    if (!isCalcContest(item)) item.items = clampItems(r.items, CALC_MIN_ITEMS);
    return item;
  }
  return null;
}

const sameItem = (a: CourseItem, b: CourseItem) =>
  a.kind === b.kind && (a.kind === 'basics' ? a.stage === (b as typeof a).stage
    : a.kind === 'calendar' ? a.level === (b as typeof a).level
      : a.kind === 'calc' ? a.eventId === (b as typeof a).eventId && a.level === (b as typeof a).level
        : a.eventId === (b as typeof a).eventId && a.run === (b as typeof a).run);

/** 항목을 가리키는 말 — '2단계', '3칸'(달력), 종목 이름('제곱근 2칸'). 스승님이 청했는데 코스에 그대로 남지 않은 것을 말하는 문장은 뺀다 */
function mentionsOf(r: Record<string, unknown>): string[] {
  const n = int(r.kind === 'basics' ? r.stage : r.level);
  if (r.kind === 'basics' && n > 0) return [`${n}단계`];
  /* 계산 종목으로 잘못 온 달력도 달력 칸 이름('N칸')으로 — 코스에 남은 달력 칸과 견준다 */
  if ((r.kind === 'calendar' || (r.kind === 'calc' && r.eventId === 'calendar')) && n > 0) return [`${n}칸`];
  if (r.kind === 'calc') {
    const name = typeof r.eventId === 'string' ? findDiscipline(r.eventId)?.name : undefined;
    return name && n > 0 ? [`${name} ${n}칸`] : [];
  }
  const name = r.kind === 'event' && typeof r.eventId === 'string' ? findDiscipline(r.eventId)?.name : undefined;
  return name ? [name] : [];
}
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* 이름 없는 'N칸'(달력)이 '제곱근 N칸' 처럼 계산 종목 이름이 붙은 말에 걸리지 않게 그 말을 먼저 지우고 찾는다 */
const NAMED_CALC = CALC_EVENTS.filter((e) => e.id !== 'calendar').map((e) => new RegExp(`${esc(e.name)}\\s*\\d+\\s*칸`, 'g'));
const says = (text: string, m: string) => {
  const d = /^(\d+)(.*)$/.exec(m);
  if (!d) return text.includes(m);
  const bare = NAMED_CALC.reduce((t, re) => t.replace(re, ''), text);
  return new RegExp(`(?<![\\d.])${d[1]}\\s*${d[2]}`).test(bare);
};

/**
 * AI 코스 답 → 쓸 수 있는 코스. 항목은 1~5개, 예상 분은 코드가 다시 계산하고 분량(minutes)에 맞춘다.
 * 가진 시간보다 긴 기억력 종목은 연습으로 내리고, 그래도 길면 버린다(짧은 항목이 대신 빠지지 않게).
 * 쓸 항목이 하나도 없으면 null(→ 규칙 코치).
 */
export function validateCourse(raw: unknown, s: CoachSummary, minutes: number): Course | null {
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  const allowed = allowedIn(courseUser(s, minutes), s);
  const cap = minutes * 60_000;
  const asked: string[] = [];
  const drafts: Draft[] = [];
  for (const r of raw.items) {
    if (!isObj(r)) continue;
    asked.push(...mentionsOf(r));
    if (drafts.length >= MAX_COURSE_ITEMS) continue;
    let item = cleanItem(r, s);
    if (item?.kind === 'event' && estimateMs(item, s) > cap) {
      const easy = { ...item, run: 'easy' as const };
      item = estimateMs(easy, s) <= cap ? easy : null;
    }
    if (!item || drafts.some((d) => sameItem(d, item))) continue;
    const why = oneLine(r.why).slice(0, 100);
    drafts.push({ ...item, why: why && plain(why) && numbersOk(why, allowed) ? why : defaultWhy(item) });
  }
  if (!drafts.length) return null;
  /* 넘치면 줄이고(fit), 모자라면 채운다(fill) — 분량은 코드가 맞춘다 */
  const items = finalize(fill(fit(drafts, s, minutes), s, minutes, ruleCourse(s, minutes).items), s);
  /* 고치거나 버린 항목(예: 3단계를 청했으나 2단계로 내림)을 말하는 문장·이유는 코스와 어긋나므로 뺀다 */
  const kept = new Set(items.flatMap((i) => mentionsOf(i as unknown as Record<string, unknown>)));
  const lost = asked.filter((m) => !kept.has(m));
  const off = (t: string) => lost.some((m) => says(t, m));
  const say = keepSentences(typeof raw.say === 'string' ? raw.say : '', allowed, off).slice(0, 240);
  return { say: say || SAFE_SAY, items: items.map((i) => (off(i.why) ? { ...i, why: defaultWhy(i) } : i)) };
}

/** 복기 답 검사 — say 가 남지 않으면 null */
export function validateReview(raw: unknown, input: ReviewInput): Review | null {
  if (!isObj(raw)) return null;
  const allowed = allowedIn(reviewUser(input), input);
  const say = keepSentences(typeof raw.say === 'string' ? raw.say : '', allowed).slice(0, 300);
  if (!say) return null;
  const next = oneLine(raw.next).slice(0, 120);
  return { say, next: next && plain(next) && numbersOk(next, allowed) ? next : '' };
}

const MAX_FOCUS = 3;

/** 주간 리뷰 답 검사 — 복기와 같은 잣대. say 가 남지 않으면 null, focus 는 평문·표에 있는 숫자만 최대 3개 */
export function validateWeekly(raw: unknown, input: WeeklyInput): WeeklyReview | null {
  if (!isObj(raw)) return null;
  const allowed = allowedIn(weeklyUser(input), input);
  const say = keepSentences(typeof raw.say === 'string' ? raw.say : '', allowed)
    .split(/(?<=[.!?])\s+/).slice(0, 3).join(' ').slice(0, 300);
  if (!say) return null;
  const focus = (Array.isArray(raw.focus) ? raw.focus : []).map(oneLine)
    .filter((f, i, all) => f && f.length <= 120 && plain(f) && numbersOk(f, allowed) && all.indexOf(f) === i)
    .slice(0, MAX_FOCUS);
  return { say, focus };
}
