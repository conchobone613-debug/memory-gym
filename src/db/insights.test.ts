import { describe, expect, it } from 'vitest';
import {
  cardTrend, CSV_HEADER, disciplineCards, domainMinutes, exportCsv, exportFileName, exportJson, weakness, WEAK_MIN_ITEMS,
  type WeaknessInput,
} from './insights';
import { summarize, type RawLogs, type SessionSummary } from './sessions';
import type { CalcItem, CalcSession } from './db';
import type { CalcLog } from './calcLog';

const T = new Date(2026, 8, 26, 12, 0, 0).getTime(); // 2026-09-26 정오 (현지 시각)
const DAY = 86_400_000;

/** 판 하나 — accuracy 는 correct/items 로 맞춘다 */
function run(o: Partial<SessionSummary> & Pick<SessionSummary, 'disciplineId' | 'startedAt'>): SessionSummary {
  const items = o.items ?? 10;
  const correct = o.correct ?? 9;
  return {
    id: `${o.disciplineId}-${o.mode ?? 'practice'}-${o.startedAt}`, kind: 'calc', domain: 'calc', title: o.disciplineId,
    mode: 'practice', durationMs: 60_000, perItemMs: 1000, ...o, items, correct, accuracy: correct / items,
  };
}

/*
 * 시험 안의 독립 CSV 파서(RFC 4180) — 내보내기 코드를 쓰지 않고 따로 읽는다.
 * 줄 끝은 CRLF 만 받는다(따옴표 밖의 LF 하나는 오류).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
      continue;
    }
    if (ch === ',') { row.push(cell); cell = ''; closed = false; continue; }
    if (ch === '\r') {
      if (text[i + 1] !== '\n') throw new Error('CR 뒤에 LF 가 없다');
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false; i++;
      continue;
    }
    if (ch === '\n') throw new Error('줄 끝이 CRLF 가 아니다');
    if (closed) throw new Error('닫는 따옴표 뒤에 글자가 있다');
    if (ch === '"') {
      if (cell !== '') throw new Error('칸 가운데에 따옴표가 있다');
      quoted = true;
      continue;
    }
    cell += ch;
  }
  if (quoted) throw new Error('따옴표가 닫히지 않았다');
  row.push(cell);
  rows.push(row);
  return rows;
}

describe('통합 기록의 점수 칸', () => {
  const empty: RawLogs = {
    mappingSessions: [], mappingAttempts: [], drillSessions: [], drillAttempts: [], recallSessions: [], calcSessions: [], calcItems: [],
  };
  const calc = (id: string, mode: 'practice' | 'contest', endedAt?: number): CalcSession => ({
    id, disciplineId: 'multiplication', mode, rules: {}, params: { level: 1 }, seed: 'x', startedAt: T, correct: 1, wrong: 0, score: 7,
    ...(endedAt ? { endedAt } : {}),
  });
  const item = (sessionId: string): CalcItem => ({
    id: `${sessionId}-0`, sessionId, index: 0, kind: 'mul', prompt: '12×34', expected: '408', answered: '408', isCorrect: true, rtMs: 3000, shownAt: T,
  });

  it('회상은 판의 점수를, 계산은 끝까지 치른 모의 대회의 점수만 둔다', () => {
    const out = summarize({
      ...empty,
      recallSessions: [
        { id: 'sp', mode: 'digits', presetName: 'p', eventId: 'spoken-numbers', runMode: 'real', stimulus: ['1', '2'], memorizeMs: 0, memorizeUsedMs: 2000, recallMs: 0, startedAt: T, correct: 2, wrong: 0, blank: 0, score: 34, params: { intervalMs: 1000 } },
        { id: 'sn', mode: 'digits', presetName: 'p', eventId: 'speed-numbers', runMode: 'real', stimulus: ['1'], memorizeMs: 0, memorizeUsedMs: 1000, recallMs: 0, startedAt: T, correct: 1, wrong: 0, blank: 0 },
      ],
      calcSessions: [calc('done', 'contest', T + 60_000), calc('cancel', 'contest'), calc('prac', 'practice', T + 60_000)],
      calcItems: [item('done'), item('cancel'), item('prac')],
    });
    const by = (id: string) => out.find((s) => s.id === id)!;
    expect(by('sp').score).toBe(34);
    expect('score' in by('sn')).toBe(false);
    expect(by('done').score).toBe(7);
    expect('score' in by('cancel')).toBe(false);
    expect('score' in by('prac')).toBe(false);
  });
});

describe('종목별 카드', () => {
  it('최고·추세는 실제 판 값 — 오래된 것 → 최근, 최근 20판까지', () => {
    const runs = Array.from({ length: 25 }, (_, i) => run({ disciplineId: 'multiplication', startedAt: T - (25 - i) * DAY, items: 100, correct: 50 + i }));
    const [card] = disciplineCards(runs, T);
    expect(card).toMatchObject({ id: 'multiplication', domain: 'calc', name: '곱셈', runs: 25, lastDay: '2026-09-25', daysAgo: 1 });
    expect(card.practice.trend).toEqual(Array.from({ length: 20 }, (_, i) => 55 + i)); // 앞 5판은 잘린다
    expect(card.practice.days[0]).toBe('2026-09-06');
    expect(card.practice.days.at(-1)).toBe('2026-09-25');
    expect(card.practice).toMatchObject({ runs: 25, lastPct: 74, bestPct: 74, bestLabel: '74%' });
    expect(card.contest).toEqual({ runs: 0, best: null, bestLabel: '', unit: '점', trend: [], days: [] });
  });

  it('점수가 있는 종목은 모의 대회 점수로, 없는 종목은 정확도로', () => {
    const cards = disciplineCards([
      run({ disciplineId: 'spoken-numbers', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T - 2 * DAY, score: 12 }),
      run({ disciplineId: 'spoken-numbers', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T - DAY, score: 34 }),
      run({ disciplineId: 'spoken-numbers', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T, score: 20 }),
      run({ disciplineId: 'speed-cards', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T - DAY, items: 52, correct: 50 }),
      run({ disciplineId: 'speed-cards', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T, items: 52, correct: 26 }),
      run({ disciplineId: 'binary', domain: 'memory', kind: 'recall', mode: 'contest', startedAt: T, score: 9 }),
      run({ disciplineId: 'addition', mode: 'contest', startedAt: T, score: 150 }),
    ], T);
    const by = (id: string) => cards.find((c) => c.id === id)!;
    expect(by('spoken-numbers').contest).toMatchObject({ runs: 3, best: 34, bestLabel: '34자리', unit: '자리', trend: [12, 34, 20] });
    expect(by('speed-cards').contest).toMatchObject({ best: 96, bestLabel: '96%', unit: '%', trend: [96, 50] });
    expect(by('binary').contest.bestLabel).toBe('9점');
    expect(by('addition').contest.bestLabel).toBe('150점');
  });

  it('점수 종목의 취소한 모의 대회(점수 없음)는 모의 대회에 넣지 않고, 그뿐인 종목은 카드를 내지 않는다', () => {
    const cards = disciplineCards([
      run({ disciplineId: 'sqrt', mode: 'contest', startedAt: T - DAY, score: 5 }),
      run({ disciplineId: 'sqrt', mode: 'contest', startedAt: T }),
      run({ disciplineId: 'surprise', mode: 'contest', startedAt: T }),
    ], T);
    expect(cards.map((c) => c.id)).toEqual(['sqrt']);
    expect(cards[0]).toMatchObject({ runs: 1, lastDay: '2026-09-25', contest: { runs: 1, trend: [5] } });
  });

  it('등록부 순서(기초 → 기억력 → 계산), 기초 이름은 기초 N단계, 기록 없는 종목은 뺀다', () => {
    const cards = disciplineCards([
      run({ disciplineId: 'calendar', startedAt: T }),
      run({ disciplineId: 'binary', domain: 'memory', kind: 'recall', startedAt: T }),
      run({ disciplineId: 'basics-3', domain: 'memory', kind: 'drill', startedAt: T }),
      run({ disciplineId: 'speed-numbers', domain: 'memory', kind: 'recall', startedAt: T }),
      run({ disciplineId: 'basics-1', domain: 'memory', kind: 'mapping', startedAt: T }),
    ], T);
    expect(cards.map((c) => c.id)).toEqual(['basics-1', 'basics-3', 'speed-numbers', 'binary', 'calendar']);
    expect(cards[0].name).toBe('기초 1단계');
    expect(cards[4]).toMatchObject({ name: '달력', daysAgo: 0 });
  });

  it('추세선 — 둘 다 있으면 모의 대회가 2판 이상일 때 모의 대회, 아니면 연습', () => {
    const p = [run({ disciplineId: 'addition', startedAt: T - 3 * DAY }), run({ disciplineId: 'addition', startedAt: T - 2 * DAY, correct: 7 })];
    const c1 = run({ disciplineId: 'addition', mode: 'contest', startedAt: T - DAY, score: 8 });
    const c2 = run({ disciplineId: 'addition', mode: 'contest', startedAt: T, score: 9 });
    expect(cardTrend(disciplineCards([...p, c1], T)[0])).toMatchObject({ mode: 'practice', label: '연습 정확도', unit: '%', values: [90, 70] });
    expect(cardTrend(disciplineCards([...p, c1, c2], T)[0])).toMatchObject({ mode: 'contest', label: '모의 대회 점수', unit: '점', values: [8, 9] });
    expect(cardTrend(disciplineCards([c1], T)[0])).toMatchObject({ mode: 'contest', values: [8] }); // 모의 대회뿐이면 한 판이라도
    const cards = disciplineCards([run({ disciplineId: 'speed-cards', domain: 'memory', mode: 'contest', startedAt: T })], T);
    expect(cardTrend(cards[0]).label).toBe('모의 대회 정확도');
  });
});

describe('영역별 훈련 시간', () => {
  it('오늘까지 days 일, 오래된 날이 앞 — 영역마다 분 합', () => {
    const rows = domainMinutes([
      run({ disciplineId: 'calendar', startedAt: T, durationMs: 3 * 60_000 }),
      run({ disciplineId: 'basics-1', domain: 'memory', startedAt: T + 3600_000, durationMs: 12 * 60_000 }),
      run({ disciplineId: 'basics-1', domain: 'memory', startedAt: T - 6 * DAY, durationMs: 90_000 }),
      run({ disciplineId: 'addition', startedAt: T - 7 * DAY, durationMs: 60 * 60_000 }), // 7일 창 밖
    ], 7, T);
    expect(rows.map((r) => r.day)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(rows[0]).toEqual({ day: '2026-09-20', memoryMin: 1.5, calcMin: 0 });
    expect(rows[6]).toEqual({ day: '2026-09-26', memoryMin: 12, calcMin: 3 });
    const total = rows.reduce((a, r) => a + r.memoryMin + r.calcMin, 0);
    expect(total).toBe(16.5);
    expect(domainMinutes([], 30, T)).toHaveLength(30);
  });
});

describe('약점 요약', () => {
  const calcSession = (id: string, disciplineId: string, params: Record<string, number | string>, mode: 'practice' | 'contest' = 'practice'): CalcSession => ({
    id, disciplineId, mode, rules: {}, params, seed: 'x', startedAt: T - DAY, endedAt: T - DAY + 1000, correct: 0, wrong: 0, score: 0,
  });
  /** n 문항 중 앞의 correct 개를 맞힌 문항들 */
  const items = (sessionId: string, n: number, correct: number, kind = 'x', shownAt = T - DAY): CalcItem[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${sessionId}-${kind}-${i}`, sessionId, index: i, kind, prompt: 'p', expected: '1', answered: i < correct ? '1' : '2',
      isCorrect: i < correct, rtMs: 1000, shownAt,
    }));
  const log = (sessions: CalcSession[], its: CalcItem[]): CalcLog => ({ sessions, items: its });
  const base: WeaknessInput = { now: T, slowImages: [], recallSessions: [], recallCells: [], calcLogs: {} };

  it('계산 — 칸·유형으로 묶어 정확도가 낮은 것 상위 3, 문항 10개 이상만', () => {
    const w = weakness({
      ...base,
      calcLogs: {
        multiplication: log(
          [calcSession('m4', 'multiplication', { level: 4 }), calcSession('m2', 'multiplication', { level: 2 }), calcSession('mc', 'multiplication', { level: 8 }, 'contest')],
          [...items('m4', 20, 14), ...items('m2', WEAK_MIN_ITEMS - 1, 0), ...items('mc', 30, 0)],
        ),
        surprise: log(
          [calcSession('s', 'surprise', { level: 1, type: 'mix' })],
          [...items('s', 10, 5, 'div'), ...items('s', 10, 9, 'sq'), ...items('s', 12, 12, 'expr')],
        ),
        addition: log(
          [calcSession('a', 'addition', { level: 1 }), calcSession('af', 'addition', { level: 1, flash: 1, intervalMs: 800 })],
          [...items('a', 10, 8), ...items('af', 10, 3)],
        ),
        sqrt: log([calcSession('q', 'sqrt', { level: 1 })], items('q', 40, 0, 'x', T - 31 * DAY)), // 30일 밖
      },
    });
    expect(w.calc.lowAccuracy).toEqual([
      { id: 'addition:1:flash', name: '덧셈 2자리 × 5개 · 플래시', accuracyPct: 30, n: 10 },
      { id: 'surprise:div', name: '서프라이즈 · 나눗셈', accuracyPct: 50, n: 10 },
      { id: 'multiplication:4', name: '곱셈 5×5', accuracyPct: 70, n: 20 },
    ]);
  });

  it('다 맞힌 묶음과 9문항 묶음은 약점이 아니다', () => {
    const w = weakness({
      ...base,
      calcLogs: { multiplication: log([calcSession('m', 'multiplication', { level: 1 })], items('m', 12, 12)) },
    });
    expect(w.calc.lowAccuracy).toEqual([]);
  });

  it('반올림해 100% 로 보이는 묶음(200문항 중 199)은 약점이 아니다', () => {
    const w = weakness({
      ...base,
      calcLogs: { multiplication: log([calcSession('m', 'multiplication', { level: 1 })], items('m', 200, 199)) },
    });
    expect(w.calc.lowAccuracy).toEqual([]);
  });

  it('달력 느린 단계 — 최근 30일, 맞힌 단계만, 느린 것부터', () => {
    const step = (name: string, ms: number, ok = true) => ({ name, ms, ok });
    const cal = (id: string, steps: ReturnType<typeof step>[], shownAt = T - DAY): CalcItem => ({
      id, sessionId: 'c', index: 0, kind: 'full', prompt: 'p', expected: '1', answered: '1', isCorrect: true, rtMs: 1, shownAt, steps,
    });
    const w = weakness({
      ...base,
      calcLogs: {
        calendar: log([calcSession('c', 'calendar', { level: 3, steps: 1 })], [
          cal('a', [step('연도 코드', 2000), step('월 코드', 4000), step('요일', 1000)]),
          cal('b', [step('연도 코드', 3000), step('월 코드', 9000, false), step('요일', 1000)]),
          cal('old', [step('연도 코드', 99_000)], T - 40 * DAY),
        ]),
      },
    });
    expect(w.calc.calendarSteps).toEqual([
      { name: '월 코드', sec: 4, n: 1 }, { name: '연도 코드', sec: 2.5, n: 2 }, { name: '요일', sec: 1, n: 2 },
    ]);
  });

  it('기억력 — 느린 이미지 상위 3, 최근 30일 회상의 오답 원인 태그', () => {
    const img = (key: string, medianRt: number) => ({ key, name: `이름${key}`, medianRt, attempts: 12, errRate: 0 });
    const w = weakness({
      ...base,
      slowImages: [img('47', 2800), img('82', 2400), img('13', 2000), img('00', 1500)],
      recallSessions: [{ id: 'r', startedAt: T - DAY }, { id: 'old', startedAt: T - 40 * DAY }],
      recallCells: [
        { sessionId: 'r', errorTags: ['image', 'locus'] }, { sessionId: 'r', errorTags: ['image'] },
        { sessionId: 'old', errorTags: ['blank', 'blank', 'blank'] },
      ],
    });
    expect(w.memory.slowImages).toEqual([
      { key: '47', name: '이름47', sec: 2.8, n: 12 }, { key: '82', name: '이름82', sec: 2.4, n: 12 }, { key: '13', name: '이름13', sec: 2, n: 12 },
    ]);
    expect(w.memory.errorTags).toEqual([{ tag: 'image', name: '이미지 혼동', n: 2 }, { tag: 'locus', name: '장소', n: 1 }]);
  });
});

describe('내려받기', () => {
  const tricky = '곱셈, "8×8" 판\n둘째 줄';
  const rows = [
    run({ disciplineId: 'multiplication', title: tricky, startedAt: new Date(2026, 8, 25, 7, 5).getTime(), items: 3, correct: 2, perItemMs: 12_346, durationMs: 150_000 }),
    run({ disciplineId: 'spoken-numbers', domain: 'memory', kind: 'recall', title: '듣고 외우는 숫자', mode: 'contest', startedAt: new Date(2026, 8, 26, 21, 40).getTime(), items: 100, correct: 97, perItemMs: 0, durationMs: 400_000, score: 34 }),
  ];

  it('CSV — BOM · CRLF · 한국어 머리글 · 최근 것이 앞 · 값 왕복(쉼표·따옴표·줄바꿈이 든 칸)', () => {
    const csv = exportCsv(rows);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.charCodeAt(1)).not.toBe(0xfeff); // BOM 은 하나
    const table = parseCsv(csv.slice(1));
    expect(table[0]).toEqual([...CSV_HEADER]);
    expect(table[0]).toEqual(['날짜', '시각', '영역', '종목', '모드', '문항 수', '정답 수', '정확도(%)', '문항당 시간(초)', '걸린 시간(분)', '점수']);
    expect(table).toHaveLength(3);
    for (const r of table) expect(r).toHaveLength(11);
    expect(table[1]).toEqual(['2026-09-26', '21:40', '기억력', '듣고 외우는 숫자', '모의 대회', '100', '97', '97.0', '', '6.7', '34']);
    expect(table[2]).toEqual(['2026-09-25', '07:05', '계산', tricky, '연습', '3', '2', '66.7', '12.35', '2.5', '']);
  });

  it('빈 기록도 머리글 한 줄', () => {
    expect(parseCsv(exportCsv([]).slice(1))).toEqual([[...CSV_HEADER]]);
  });

  it('JSON — 세션 요약과 점수만, 개인 자산 칸은 없다', () => {
    const leaky = { ...rows[1], aiKey: 'sk-secret', name: '사슴' } as SessionSummary;
    const out = JSON.parse(exportJson([rows[0], leaky], T));
    expect(Object.keys(out)).toEqual(['app', 'version', 'exportedAt', 'sessions']);
    expect(out).toMatchObject({ app: 'Lampadas', version: 1, exportedAt: new Date(T).toISOString() });
    expect(out.sessions.map((s: SessionSummary) => s.disciplineId)).toEqual(['spoken-numbers', 'multiplication']);
    expect(out.sessions[0]).toEqual({
      id: rows[1].id, kind: 'recall', domain: 'memory', disciplineId: 'spoken-numbers', title: '듣고 외우는 숫자', mode: 'contest',
      startedAt: rows[1].startedAt, durationMs: 400_000, items: 100, correct: 97, accuracy: 0.97, perItemMs: 0, score: 34,
    });
    expect('score' in out.sessions[1]).toBe(false);
    expect(JSON.stringify(out)).not.toContain('sk-secret');
  });

  it('파일 이름은 현지 날짜', () => {
    expect(exportFileName('csv', T)).toBe('lampadas-sessions-2026-09-26.csv');
    expect(exportFileName('json', T)).toBe('lampadas-sessions-2026-09-26.json');
  });
});
