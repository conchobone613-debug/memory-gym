import { db, ERROR_TAG_LABEL, type ErrorTag, type RecallCell, type RecallSession } from './db';
import { localDayKey, movers, type MoverRow } from './analytics';
import { loadCalcLog, type CalcLog } from './calcLog';
import type { SessionSummary } from './sessions';
import { CALC_EVENTS, DOMAIN_NAME, findDiscipline, MEMORY_EVENTS, type Domain } from '../data/events';
import { CAL_LEVELS } from '../calc/calendarLadder';
import { stepAverages } from '../calc/calendarDrill';
import { calcLevels, sessionFlashMs } from '../calc/ladders';
import { SURPRISE_TYPES } from '../calc/surprise';

/*
 * 통합 분석 — 기록 탭의 '종목별 기록'·약점 요약·내려받기. 모두 통합 기록(sessions.ts)을 읽을 때 합친 값 위에서 돈다.
 * 숫자는 실제 판 값만 — 빈 날·빈 판을 메워 넣지 않는다.
 */

const DAY = 86_400_000;
const TREND_MAX = 20;
const TOP = 3;
/** 약점으로 보려면 묶음에 문항이 이만큼은 있어야 한다 — 몇 문항짜리 우연을 약점이라 부르지 않게 */
export const WEAK_MIN_ITEMS = 10;

const pct = (x: number) => Math.round(x * 100);
const sec = (ms: number) => Math.round(ms / 10) / 100;
const min1 = (ms: number) => Math.round(ms / 6000) / 10;
const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
const recentFirst = (a: SessionSummary, b: SessionSummary) => b.startedAt - a.startedAt;

/* ───────── 종목 ───────── */

const ORDER = ['basics-1', 'basics-2', 'basics-3', ...MEMORY_EVENTS.map((e) => e.id), ...CALC_EVENTS.map((e) => e.id)];

/** 등록부 순서(기초 → 기억력 종목 → 계산 종목). 등록부에 없는 id 는 맨 뒤 */
export const disciplineOrder = (id: string) => {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
};

/** 종목 이름 — 기초는 '기초 N단계', 나머지는 등록부. 등록부에 없으면 fallback */
export function disciplineName(id: string, fallback = id): string {
  const b = /^basics-(\d)$/.exec(id);
  return b ? `기초 ${b[1]}단계` : findDiscipline(id)?.name ?? fallback;
}

/** 대회식 점수의 단위 — 계산은 '점', 기억력은 점수가 있는 종목만('자리'·'점'). 없으면 null(모의 대회도 정확도로 본다) */
export function scoreUnit(id: string, domain: Domain): string | null {
  if (domain === 'calc') return '점';
  return MEMORY_EVENTS.find((e) => e.id === id)?.score?.unit ?? null;
}

export interface DisciplineCard {
  id: string;
  domain: Domain;
  name: string;
  /** 연습 + (추세·최고에 든) 모의 대회 판 수 */
  runs: number;
  /** 마지막으로 한 날(YYYY-MM-DD, 현지) */
  lastDay: string;
  /** 마지막으로 한 지 며칠(오늘 = 0) */
  daysAgo: number;
  practice: {
    runs: number;
    /** 가장 최근 연습 판 정확도(%, 정수). 연습이 없으면 null */
    lastPct: number | null;
    bestPct: number | null;
    /** '96%' — 연습이 없으면 빈 글자 */
    bestLabel: string;
    /** 판마다 정확도(%) — 오래된 것 → 최근, 최근 20판까지 */
    trend: number[];
    /** trend 와 같은 순서의 날(YYYY-MM-DD) */
    days: string[];
  };
  contest: {
    /** 점수가 있는 종목은 점수가 남은 판(끝까지 치른 판)만 */
    runs: number;
    best: number | null;
    /** '9점' · '34자리' · '150점' · '96%' — 모의 대회가 없으면 빈 글자 */
    bestLabel: string;
    /** trend 값의 단위 — '점' · '자리' · '%'(점수가 없는 종목) */
    unit: string;
    /** 판마다 점수(점수가 없는 종목은 정확도 %) — 오래된 것 → 최근, 최근 20판까지 */
    trend: number[];
    days: string[];
  };
}

/** 최근 것이 앞인 판 → 오래된 것이 앞인 최근 20판의 값·날 */
function trendOf(list: SessionSummary[], value: (s: SessionSummary) => number) {
  const recent = list.slice(0, TREND_MAX).reverse();
  return { trend: recent.map(value), days: recent.map((s) => localDayKey(s.startedAt)) };
}

/** 순수 함수 — 종목마다 한 장. 등록부 순서, 기록 없는 종목은 뺀다 */
export function disciplineCards(summaries: SessionSummary[], now = Date.now()): DisciplineCard[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const s of summaries) groups.set(s.disciplineId, [...(groups.get(s.disciplineId) ?? []), s]);

  const cards: DisciplineCard[] = [];
  for (const [id, all] of groups) {
    const list = [...all].sort(recentFirst);
    const domain = list[0].domain;
    const unit = scoreUnit(id, domain);
    const practice = list.filter((s) => s.mode === 'practice');
    /* 점수가 있는 종목은 점수가 남은 판만 — 취소한 모의 대회를 정확도로 섞어 넣으면 단위가 뒤섞인다 */
    const contest = list.filter((s) => s.mode === 'contest' && (!unit || s.score !== undefined));
    const cVal = (s: SessionSummary) => (unit ? s.score! : pct(s.accuracy));
    const played = [...practice, ...contest].sort(recentFirst);
    if (!played.length) continue;

    const pVals = practice.map((s) => pct(s.accuracy));
    const bestPct = pVals.length ? Math.max(...pVals) : null;
    const best = contest.length ? Math.max(...contest.map(cVal)) : null;
    cards.push({
      id, domain, name: disciplineName(id, list[0].title), runs: played.length,
      lastDay: localDayKey(played[0].startedAt),
      daysAgo: Math.round((midnight(now) - midnight(played[0].startedAt)) / DAY),
      practice: {
        runs: practice.length, lastPct: pVals[0] ?? null, bestPct, bestLabel: bestPct == null ? '' : `${bestPct}%`,
        ...trendOf(practice, (s) => pct(s.accuracy)),
      },
      contest: {
        runs: contest.length, best, bestLabel: best == null ? '' : `${best}${unit ?? '%'}`, unit: unit ?? '%',
        ...trendOf(contest, cVal),
      },
    });
  }
  return cards.sort((a, b) => disciplineOrder(a.id) - disciplineOrder(b.id) || a.id.localeCompare(b.id));
}

export interface CardTrend {
  mode: 'practice' | 'contest';
  /** 작은 글자 — '연습 정확도' · '모의 대회 점수' · '모의 대회 정확도' */
  label: string;
  unit: string;
  values: number[];
  days: string[];
}

/** 카드의 추세선 — 둘 다 있으면 모의 대회가 2판 이상일 때 모의 대회, 아니면 연습 */
export function cardTrend(c: DisciplineCard): CardTrend {
  const contest = c.contest.runs > 0 && (c.practice.runs === 0 || c.contest.runs >= 2);
  if (!contest) return { mode: 'practice', label: '연습 정확도', unit: '%', values: c.practice.trend, days: c.practice.days };
  return {
    mode: 'contest', label: c.contest.unit === '%' ? '모의 대회 정확도' : '모의 대회 점수', unit: c.contest.unit,
    values: c.contest.trend, days: c.contest.days,
  };
}

/* ───────── 영역별 훈련 시간 ───────── */

export interface DayMinutes {
  /** YYYY-MM-DD(현지) */
  day: string;
  memoryMin: number;
  calcMin: number;
}

/** 순수 함수 — 오늘까지 days 일, 오래된 날이 앞. 분은 소수 한 자리 */
export function domainMinutes(summaries: SessionSummary[], days: number, now = Date.now()): DayMinutes[] {
  const acc = new Map<string, Record<Domain, number>>();
  for (const s of summaries) {
    const k = localDayKey(s.startedAt);
    const a = acc.get(k) ?? { memory: 0, calc: 0 };
    a[s.domain] += s.durationMs;
    acc.set(k, a);
  }
  const out: DayMinutes[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const day = localDayKey(d.getTime());
    const a = acc.get(day);
    out.push({ day, memoryMin: min1(a?.memory ?? 0), calcMin: min1(a?.calc ?? 0) });
  }
  return out;
}

/* ───────── 약점 요약 ───────── */

export interface Weakness {
  memory: {
    /** 느린 이미지 상위 3 — 중앙 반응(초)과 시도 수 */
    slowImages: { key: string; name: string; sec: number; n: number }[];
    /** 최근 30일 종목 회상의 오답 원인 태그 — 많은 것부터 상위 3 */
    errorTags: { tag: ErrorTag; name: string; n: number }[];
  };
  calc: {
    /** 최근 30일 달력 단계 입력의 단계별 평균(맞힌 단계만) — 느린 것부터 */
    calendarSteps: { name: string; sec: number; n: number }[];
    /** 최근 30일 연습 문항을 칸(서프라이즈는 유형)으로 묶어 정확도가 낮은 것 상위 3 — 문항 10개 이상, 다 맞힌 묶음은 뺀다 */
    lowAccuracy: { id: string; name: string; accuracyPct: number; n: number }[];
  };
}

export interface WeaknessInput {
  now: number;
  /** db/analytics movers().slowest */
  slowImages: MoverRow[];
  recallSessions: Pick<RecallSession, 'id' | 'startedAt'>[];
  recallCells: Pick<RecallCell, 'sessionId' | 'errorTags'>[];
  /** 계산 종목 id → 기록(달력 포함) */
  calcLogs: Record<string, CalcLog>;
}

/** 묶음 이름 — '곱셈 5×5' · '서프라이즈 · 나눗셈' · '달력 한 세기'. 플래시 판은 잣대가 달라 따로 묶는다 */
function groupOf(eventId: string, level: number, kind: string, flash: boolean): { id: string; name: string } {
  const ev = findDiscipline(eventId)?.name ?? eventId;
  if (eventId === 'surprise') return { id: `surprise:${kind}`, name: `${ev} · ${SURPRISE_TYPES.find((t) => t.id === kind)?.name ?? kind}` };
  /* 칸이 없는 판(params.level 이 없던 옛 기록)은 종목 이름만 */
  const lv = !Number.isFinite(level) ? ''
    : ` ${(eventId === 'calendar' ? CAL_LEVELS : calcLevels(eventId)).find((l) => l.n === level)?.name ?? `${level}칸`}`;
  return flash
    ? { id: `${eventId}:${level}:flash`, name: `${ev}${lv} · 플래시` }
    : { id: `${eventId}:${level}`, name: `${ev}${lv}` };
}

/** 순수 함수 — 영역별 약점. 숫자는 실제 값, 표본 수 n 과 함께 */
export function weakness(inp: WeaknessInput): Weakness {
  const since = inp.now - 30 * DAY;

  const recent = new Set(inp.recallSessions.filter((s) => s.startedAt >= since).map((s) => s.id));
  const tags = new Map<ErrorTag, number>();
  for (const c of inp.recallCells) {
    if (recent.has(c.sessionId)) for (const t of c.errorTags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }

  const cal = inp.calcLogs.calendar?.items.filter((i) => i.shownAt >= since) ?? [];
  const steps = stepAverages(cal.map((i) => ({ steps: i.steps?.filter((st) => st.ok !== false) })));

  const groups = new Map<string, { name: string; n: number; correct: number }>();
  for (const [eventId, log] of Object.entries(inp.calcLogs)) {
    const practice = new Map(log.sessions.filter((s) => s.mode === 'practice').map((s) => [s.id, s]));
    for (const it of log.items) {
      const s = practice.get(it.sessionId);
      if (!s || it.shownAt < since) continue;
      const g = groupOf(eventId, Number(s.params.level), it.kind, sessionFlashMs(s.params) > 0);
      const a = groups.get(g.id) ?? { name: g.name, n: 0, correct: 0 };
      a.n += 1;
      if (it.isCorrect) a.correct += 1;
      groups.set(g.id, a);
    }
  }

  return {
    memory: {
      slowImages: inp.slowImages.filter((m) => m.medianRt > 0).slice(0, TOP)
        .map((m) => ({ key: m.key, name: m.name, sec: sec(m.medianRt), n: m.attempts })),
      errorTags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([tag, n]) => ({ tag, name: ERROR_TAG_LABEL[tag], n })),
    },
    calc: {
      calendarSteps: steps.sort((a, b) => b.avgMs - a.avgMs).map((x) => ({ name: x.name, sec: sec(x.avgMs), n: x.n })),
      lowAccuracy: [...groups].filter(([, g]) => g.n >= WEAK_MIN_ITEMS && pct(g.correct / g.n) < 100)
        .sort(([, a], [, b]) => a.correct / a.n - b.correct / b.n || b.n - a.n)
        .slice(0, TOP)
        .map(([id, g]) => ({ id, name: g.name, accuracyPct: pct(g.correct / g.n), n: g.n })),
    },
  };
}

/** 저장소에서 읽어 약점 요약을 만든다 */
export async function loadWeakness(now = Date.now()): Promise<Weakness> {
  const [mv, recallSessions, logs] = await Promise.all([
    movers(TOP),
    db.recallSessions.where('startedAt').aboveOrEqual(now - 30 * DAY).toArray(),
    Promise.all(CALC_EVENTS.map((e) => loadCalcLog(e.id))),
  ]);
  const recallCells = recallSessions.length
    ? await db.recallCells.where('sessionId').anyOf(recallSessions.map((s) => s.id)).toArray()
    : [];
  return weakness({
    now, slowImages: mv.slowest, recallSessions, recallCells,
    calcLogs: Object.fromEntries(CALC_EVENTS.map((e, i) => [e.id, logs[i]])),
  });
}

/* ───────── 내려받기 ───────── */

const BOM = '﻿';
const CRLF = '\r\n';
const MODE_NAME = { practice: '연습', contest: '모의 대회' } as const;

export const CSV_HEADER = [
  '날짜', '시각', '영역', '종목', '모드', '문항 수', '정답 수', '정확도(%)', '문항당 시간(초)', '걸린 시간(분)', '점수',
] as const;

/** RFC 4180 — 쉼표·따옴표·줄바꿈이 든 칸은 큰따옴표로 감싸고 안의 따옴표는 두 번 */
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 노션·엑셀에 붙일 CSV — 한국어 머리글, 최근 것이 앞, 줄 끝 CRLF, 맨 앞 UTF-8 BOM.
 * lib/io.ts 의 download() 도 기본으로 BOM 을 붙이므로 bom = false 로 넘긴다(BOM 이 둘이면 첫 머리글이 깨진다).
 */
export function exportCsv(summaries: SessionSummary[]): string {
  const rows = [...summaries].sort(recentFirst).map((s) => [
    localDayKey(s.startedAt), hhmm(s.startedAt), DOMAIN_NAME[s.domain], s.title, MODE_NAME[s.mode],
    String(s.items), String(s.correct), (s.accuracy * 100).toFixed(1),
    s.perItemMs ? (s.perItemMs / 1000).toFixed(2) : '', (s.durationMs / 60_000).toFixed(1),
    s.score === undefined ? '' : String(s.score),
  ]);
  return BOM + [[...CSV_HEADER], ...rows].map((r) => r.map(cell).join(',')).join(CRLF);
}

/** 세션 요약만 — 키·설정·이미지 이름 같은 개인 자산은 넣지 않는다. 칸을 하나하나 골라 담아 나중에 요약에 칸이 늘어도 새지 않게 한다 */
export function exportJson(summaries: SessionSummary[], now = Date.now()): string {
  const sessions = [...summaries].sort(recentFirst).map((s) => ({
    id: s.id, kind: s.kind, domain: s.domain, disciplineId: s.disciplineId, title: s.title, mode: s.mode,
    startedAt: s.startedAt, durationMs: s.durationMs, items: s.items, correct: s.correct, accuracy: s.accuracy,
    perItemMs: s.perItemMs, ...(s.score !== undefined ? { score: s.score } : {}),
  }));
  return JSON.stringify({ app: 'Lampadas', version: 1, exportedAt: new Date(now).toISOString(), sessions }, null, 2);
}

/** 'lampadas-sessions-2026-09-26.csv' — 날짜는 현지 */
export const exportFileName = (ext: 'csv' | 'json', now = Date.now()) => `lampadas-sessions-${localDayKey(now)}.${ext}`;
