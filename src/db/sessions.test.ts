import { describe, expect, it } from 'vitest';
import { dayStreak, summarize, type RawLogs, type SessionSummary } from './sessions';

const T = new Date(2026, 8, 25, 12, 0, 0).getTime(); // 2026-09-25 정오 (현지 시각)
const DAY = 86_400_000;

const empty: RawLogs = {
  mappingSessions: [], mappingAttempts: [], drillSessions: [], drillAttempts: [],
  recallSessions: [], calcSessions: [], calcItems: [],
};

describe('통합 기록 — 네 가지 모양을 한 틀로', () => {
  it('각 기록을 같은 틀로 읽는다', () => {
    const out = summarize({
      ...empty,
      mappingSessions: [{ id: 'm', stage: 2, startedAt: T, itemCount: 2 }],
      mappingAttempts: [
        { id: 'm1', sessionId: 'm', order: 0, stage: 2, unit: '47', direction: 'toConsonant', prompt: '47', answer: 'ㄹㅅ', given: 'ㄹㅅ', isCorrect: true, rtMs: 1000, shownAt: T },
        { id: 'm2', sessionId: 'm', order: 1, stage: 2, unit: '12', direction: 'toConsonant', prompt: '12', answer: 'ㄱㄴ', given: 'ㄱㄷ', isCorrect: false, rtMs: 3000, shownAt: T + 5000 },
      ],
      drillSessions: [{ id: 'd', startedAt: T + 1, setIds: [], pickMode: 'srs', itemCount: 1, typedCheckRate: 1 }],
      drillAttempts: [{ id: 'd1', sessionId: 'd', order: 0, imageId: 'i', setId: 's', key: '00', rtMs: 1500, verdict: 'correct', shownAt: T + 1 }],
      recallSessions: [{
        id: 'r', mode: 'digits', presetName: '숫자 4', runMode: 'real', stimulus: ['01', '02', '03', '04'],
        memorizeMs: 0, memorizeUsedMs: 8000, recallMs: 0, recallUsedMs: 2000, startedAt: T + 2, correct: 3, wrong: 1, blank: 0,
      }],
      calcSessions: [{ id: 'c', disciplineId: 'calendar', mode: 'contest', rules: {}, params: {}, seed: 'x', startedAt: T + 3, correct: 1, wrong: 0, score: 1 }],
      calcItems: [{ id: 'c1', sessionId: 'c', index: 0, kind: 'date', prompt: '2000-01-01', expected: '6', answered: '6', isCorrect: true, rtMs: 4000, shownAt: T + 3 }],
    });

    expect(out.map((s) => s.kind)).toEqual(['calc', 'recall', 'drill', 'mapping']); // 최근 것이 앞
    const [c, r, d, m] = out;
    expect(m).toMatchObject({ domain: 'memory', disciplineId: 'basics-2', items: 2, correct: 1, accuracy: 0.5, perItemMs: 2000, durationMs: 8000 });
    expect(d).toMatchObject({ disciplineId: 'basics-3', items: 1, correct: 1, mode: 'practice' });
    expect(r).toMatchObject({ disciplineId: 'speed-numbers', mode: 'contest', items: 4, correct: 3, durationMs: 10_000, perItemMs: 2000 });
    expect(c).toMatchObject({ domain: 'calc', title: '달력', items: 1, perItemMs: 4000 });
  });

  it('문항이 하나도 없는 세션은 뺀다 (열었다 바로 닫은 것)', () => {
    const out = summarize({ ...empty, drillSessions: [{ id: 'd', startedAt: T, setIds: [], pickMode: 'srs', itemCount: 30, typedCheckRate: 1 }] });
    expect(out).toEqual([]);
  });

  it('켜 두고 자리를 비운 시간은 훈련 시간에 넣지 않는다', () => {
    const out = summarize({
      ...empty,
      drillSessions: [{ id: 'd', startedAt: T, endedAt: T + 3 * 3600_000, setIds: [], pickMode: 'srs', itemCount: 1, typedCheckRate: 1 }],
      drillAttempts: [{ id: 'd1', sessionId: 'd', order: 0, imageId: 'i', setId: 's', key: '00', rtMs: 2000, verdict: 'correct', shownAt: T + 60_000 }],
    });
    expect(out[0].durationMs).toBe(62_000);
  });

  it('eventId 가 없는 옛 회상 기록은 숫자·카드로 가른다', () => {
    const base = { presetName: 'p', stimulus: ['x'], memorizeMs: 0, memorizeUsedMs: 1, recallMs: 0, startedAt: T, correct: 1, wrong: 0, blank: 0 };
    const out = summarize({ ...empty, recallSessions: [{ ...base, id: 'a', mode: 'cards' }, { ...base, id: 'b', mode: 'digits', runMode: 'easy' }] });
    expect(out.find((s) => s.id === 'a')).toMatchObject({ disciplineId: 'speed-cards', mode: 'contest' });
    expect(out.find((s) => s.id === 'b')).toMatchObject({ disciplineId: 'speed-numbers', mode: 'practice' });
  });

  it('eventId 가 없는 이진수 판은 이진수 종목으로 읽는다', () => {
    const out = summarize({
      ...empty,
      recallSessions: [{
        id: 'x', mode: 'binary', presetName: 'p', stimulus: Array(12).fill('1'), memorizeMs: 0, memorizeUsedMs: 6000, recallMs: 0,
        startedAt: T, correct: 1, wrong: 1, blank: 0, params: { code: 'b3', rowLen: 30 },
      }],
    });
    expect(out[0]).toMatchObject({ disciplineId: 'binary', title: '이진수', perItemMs: 500 });
  });

  it('낭독 간격이 있는 판(듣기)은 문항당 시간을 재지 않는다 — 속도를 기계가 정했다', () => {
    const out = summarize({
      ...empty,
      recallSessions: [{
        id: 's', mode: 'digits', presetName: 'p', eventId: 'spoken-numbers', runMode: 'real', stimulus: Array(10).fill('3'),
        memorizeMs: 10_000, memorizeUsedMs: 10_800, recallMs: 0, recallUsedMs: 30_000, startedAt: T, correct: 4, wrong: 1, blank: 0,
        score: 7, params: { intervalMs: 1000, lang: 'ko' },
      }],
    });
    expect(out[0]).toMatchObject({ disciplineId: 'spoken-numbers', title: '듣고 외우는 숫자', perItemMs: 0, durationMs: 40_800, items: 5 });
  });
});

describe('연속일', () => {
  const s = (startedAt: number, durationMs = 60_000) => ({ startedAt, durationMs }) as SessionSummary;

  it('오늘까지 이어진 날을 센다', () => {
    expect(dayStreak([s(T), s(T - DAY), s(T - 2 * DAY), s(T - 4 * DAY)], T)).toMatchObject({ streak: 3, doneToday: true });
  });

  it('오늘 아직 안 했어도 어제까지 이어졌으면 살아 있다', () => {
    expect(dayStreak([s(T - DAY), s(T - 2 * DAY)], T)).toMatchObject({ streak: 2, doneToday: false });
  });

  it('어제를 건너뛰었으면 0', () => {
    expect(dayStreak([s(T - 2 * DAY)], T).streak).toBe(0);
  });

  it('오늘 채운 시간은 오늘 세션만 더한다', () => {
    expect(dayStreak([s(T, 5 * 60_000), s(T + 3600_000, 10 * 60_000), s(T - DAY, 99 * 60_000)], T).todayMs).toBe(15 * 60_000);
  });
});
