import { describe, expect, it } from 'vitest';
import type { RecallSession } from '../db/db';
import { scoredHistory, scoredOutcome } from './eventOutcome';

const base = { memorizeUsedMs: 101_000, recallUsedMs: 95_000 };

const session = (over: Partial<RecallSession>): RecallSession => ({
  id: 'x', mode: 'digits', presetName: '듣고 외우는 숫자 100자리 (초당 1개 / 회상 5분)', runMode: 'real',
  stimulus: [], memorizeMs: 100_000, memorizeUsedMs: 101_000, recallMs: 300_000,
  startedAt: 0, correct: 30, wrong: 10, blank: 10, score: 20, params: { intervalMs: 1000, lang: 'ko' },
  ...over,
});

describe('scoredHistory — 같은 조건의 지난 판 점수만', () => {
  const cur = { id: 'now', presetName: session({}).presetName, runMode: 'real' as const, total: 50, intervalMs: 1000 };

  it('최근 것이 앞, 이번 판과 점수 없는 판은 뺀다', () => {
    const got = scoredHistory([
      session({ id: 'a', startedAt: 1, score: 10 }),
      session({ id: 'b', startedAt: 3, score: 30 }),
      session({ id: 'now', startedAt: 4, score: 99 }),
      session({ id: 'c', startedAt: 2, score: undefined }),
    ], cur);
    expect(got).toEqual([30, 10]);
  });

  it('프리셋·모드·칸 수·낭독 간격이 다르면 뺀다', () => {
    expect(scoredHistory([
      session({ id: 'a', presetName: '커스텀 듣기 50자리' }),
      session({ id: 'b', runMode: 'easy' }),
      session({ id: 'c', correct: 31 }),
      session({ id: 'd', params: { intervalMs: 1500, lang: 'ko' } }),
    ], cur)).toEqual([]);
  });

  it('runMode 가 없는 옛 기록은 모의 대회로 본다', () => {
    expect(scoredHistory([session({ id: 'a', runMode: undefined, score: 7 })], cur)).toEqual([7]);
  });

  it('낭독 간격을 넘기지 않으면(이진수) 간격을 보지 않는다', () => {
    const bin = session({ id: 'a', mode: 'binary', params: { code: 'b3', rowLen: 30 }, score: 45 });
    expect(scoredHistory([bin], { ...cur, intervalMs: undefined })).toEqual([45]);
  });
});

describe('scoredOutcome — 듣기', () => {
  it('첫 수치가 처음 틀린 곳까지, 이어서 정확도·낭독·회상', () => {
    const o = scoredOutcome({ kind: 'spoken', score: 34, max: 100, correct: 30, total: 50, ...base, past: [] });
    expect(o.stats.map((s) => s.label)).toEqual(['처음 틀린 곳까지', '정확도', '낭독', '회상 사용']);
    expect(o.stats[0]).toMatchObject({ value: '34', unit: '자리' });
    expect(o.stats[1]).toMatchObject({ value: '60', unit: '%' });
    expect(o.stats[2].value).toBe('1:41');
  });

  it('첫 기록은 신기록이 아니다', () => {
    const o = scoredOutcome({ kind: 'spoken', score: 34, max: 100, correct: 30, total: 50, ...base, past: [] });
    expect(o.record).toBeNull();
    expect(o.near).toEqual([]);
    expect(o.sage).toBe('100자리 중 처음 틀린 곳까지 34자리일세. 틀린 자리 앞뒤를 다시 들어 보게.');
  });

  it('지난 최고를 넘으면 신기록', () => {
    const o = scoredOutcome({ kind: 'spoken', score: 34, max: 100, correct: 30, total: 50, ...base, past: [20, 30] });
    expect(o.record).toEqual({ what: '처음 틀린 곳까지 34자리' });
    expect(o.stats[0].up).toBe('▲14');
  });

  it('아까움은 신기록까지 2자리 이내일 때만', () => {
    const near = scoredOutcome({ kind: 'spoken', score: 32, max: 100, correct: 30, total: 50, ...base, past: [34] });
    expect(near.near).toEqual([{ lead: '신기록까지', value: '2자리' }]);
    expect(near.sage).toContain('신기록까지 2자리');
    const far = scoredOutcome({ kind: 'spoken', score: 31, max: 100, correct: 30, total: 50, ...base, past: [34] });
    expect(far.near).toEqual([]);
    const same = scoredOutcome({ kind: 'spoken', score: 34, max: 100, correct: 30, total: 50, ...base, past: [34] });
    expect(same.record).toBeNull(); // 같으면 신기록 아님
  });

  it('0점은 신기록도 아까움도 아니다', () => {
    const o = scoredOutcome({ kind: 'spoken', score: 0, max: 100, correct: 0, total: 50, ...base, past: [1] });
    expect(o.record).toBeNull();
    expect(o.near).toEqual([]);
  });
});

describe('scoredOutcome — 이진수', () => {
  it('줄 점수는 만점을 단위로', () => {
    const o = scoredOutcome({ kind: 'binary', score: 150, max: 240, correct: 30, total: 40, ...base, past: [] });
    expect(o.stats[0]).toMatchObject({ label: '줄 점수', value: '150', unit: '/240' });
    expect(o.stats[2].label).toBe('암기 사용');
    expect(o.sage).toBe('줄 점수 150점일세. 한 줄에 한 자리만 틀려도 반이 깎이니 줄 끝을 다시 보게.');
  });

  it('아까움은 신기록까지 15점 이내일 때만', () => {
    expect(scoredOutcome({ kind: 'binary', score: 135, max: 240, correct: 30, total: 40, ...base, past: [150] }).near)
      .toEqual([{ lead: '신기록까지', value: '15점' }]);
    expect(scoredOutcome({ kind: 'binary', score: 134, max: 240, correct: 30, total: 40, ...base, past: [150] }).near)
      .toEqual([]);
  });

  it('신기록 문구는 점수 그대로', () => {
    expect(scoredOutcome({ kind: 'binary', score: 165, max: 240, correct: 30, total: 40, ...base, past: [150] }).record)
      .toEqual({ what: '줄 점수 165점' });
  });
});
