import { describe, expect, it } from 'vitest';
import { compareBest, flapClock, flapSec, nearAccuracyGoal, nearCombo, nearRecordRt, outcomeTitle, passedOf, starsOf, type RunOutcome } from './outcome';

describe('신기록 — 실제 값으로만, 첫 기록은 아니다', () => {
  it('지난 기록이 없으면 신기록이 아니다', () => {
    expect(compareBest([], 1500, 'lower').isRecord).toBe(false);
  });
  it('반응시간은 낮을수록, 개수는 높을수록', () => {
    expect(compareBest([1800, 1600], 1570, 'lower')).toMatchObject({ isRecord: true, best: 1600, gap: 30 });
    expect(compareBest([1800, 1600], 1600, 'lower').isRecord).toBe(false); // 같으면 신기록 아님
    expect(compareBest([20, 25], 26, 'higher')).toMatchObject({ isRecord: true, best: 25 });
  });
  it('0·비정상 값은 비교에서 뺀다', () => {
    expect(compareBest([0, NaN, 1700], 1650, 'lower')).toMatchObject({ isRecord: true, best: 1700 });
  });
});

describe('아까움 — 기준 안쪽일 때만', () => {
  it('반응시간 신기록에 0.1초 이내로 못 미침', () => {
    expect(nearRecordRt([1570], 1650)).toEqual({ lead: '신기록까지', value: '0.08초' });
    expect(nearRecordRt([1570], 1700)).toBeNull(); // 0.13초 — 기준 밖
    expect(nearRecordRt([1570], 1500)).toBeNull(); // 신기록이면 아까움 아님
    expect(nearRecordRt([], 1500)).toBeNull(); // 첫 기록
  });
  it('정확도 목표에 1문제 모자람', () => {
    expect(nearAccuracyGoal(37, 40, 0.95)).toEqual({ lead: '정확도 목표까지', value: '1문제' }); // 38 필요
    expect(nearAccuracyGoal(38, 40, 0.95)).toBeNull(); // 채움
    expect(nearAccuracyGoal(36, 40, 0.95)).toBeNull(); // 2문제 — 기준 밖
    expect(nearAccuracyGoal(19, 20, 0.95)).toBeNull(); // 19/20 = 95% 채움(부동소수 경계)
  });
  it('최고 연속에 1~2 모자람', () => {
    expect(nearCombo([31], 30)).toEqual({ lead: '최고 연속까지', value: '1번' });
    expect(nearCombo([31], 28)).toBeNull();
    expect(nearCombo([], 5)).toBeNull();
  });
});

describe('성적표', () => {
  const g = (met: boolean) => ({ label: 'x', ratio: met ? 1 : 0.5, text: '', met });
  it('제목: 신기록 > 아까움 > 보통', () => {
    const base: RunOutcome = { stats: [], goals: [] };
    expect(outcomeTitle({ ...base, record: { what: '' } })).toBe('신기록입니다');
    expect(outcomeTitle({ ...base, near: [{ lead: 'a', value: 'b' }] })).toBe('아깝습니다');
    expect(outcomeTitle(base)).toBe('공부를 마쳤습니다');
  });
  it('금별 = 채운 목표 수, 합격 = 모두 채움', () => {
    const o: RunOutcome = { stats: [], goals: [g(true), g(false), g(true)] };
    expect(starsOf(o)).toBe(2);
    expect(passedOf(o)).toBe(false);
    expect(passedOf({ stats: [], goals: [g(true), g(true)] })).toBe(true);
    expect(passedOf({ stats: [], goals: [] })).toBe(false);
  });
  it('글자판 모양', () => {
    expect(flapSec(1574)).toBe('1.57');
    expect(flapClock(192_000)).toBe('3:12');
  });
});
