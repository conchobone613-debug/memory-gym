import { describe, expect, it } from 'vitest';
import { drillOutcome, goalBars } from './drillOutcome';
import type { GoalStatus } from './goals';
import type { SessionSummary } from './sessions';

const past = (perItemMs: number, items = 40, correct = 39): SessionSummary => ({
  id: String(perItemMs), kind: 'drill', domain: 'memory', disciplineId: 'basics-3', title: '', mode: 'practice',
  startedAt: 0, durationMs: 0, items, correct, accuracy: correct / items, perItemMs,
});
const run = (meanRtMs: number, correct = 39, items = 40) => ({ items, correct, meanRtMs, maxStreak: 12, totalMs: 192_000 });

describe('기초 드릴 결과', () => {
  it('첫 판은 신기록이 아니다', () => {
    expect(drillOutcome({ run: run(1500), past: [], goalAccuracy: 0.95 }).record).toBeNull();
  });

  it('정확도 목표를 채운 지난 판보다 빠르면 신기록', () => {
    const o = drillOutcome({ run: run(1570), past: [past(1600), past(1800)], goalAccuracy: 0.95 });
    expect(o.record).toEqual({ what: '평균 반응시간 1.57초' });
    expect(o.near).toEqual([]);
  });

  it('정확도 목표를 못 채운 판은 신기록 비교에 들어가지도, 신기록이 되지도 않는다', () => {
    expect(drillOutcome({ run: run(1200, 30), past: [past(1600)], goalAccuracy: 0.95 }).record).toBeNull();
    // 빠르지만 부정확했던 지난 판(1000ms, 30/40)은 기준이 아니다 → 1570 이 신기록
    expect(drillOutcome({ run: run(1570), past: [past(1000, 40, 30), past(1600)], goalAccuracy: 0.95 }).record).not.toBeNull();
  });

  it('아까움은 실제 차이로: 신기록까지 0.08초', () => {
    const o = drillOutcome({ run: run(1650), past: [past(1570)], goalAccuracy: 0.95 });
    expect(o.record).toBeNull();
    expect(o.near).toContainEqual({ lead: '신기록까지', value: '0.08초' });
  });

  it('▲ 는 지난번보다 나아진 것만', () => {
    const o = drillOutcome({ run: run(1500), past: [past(1620, 40, 36)], goalAccuracy: 0.95 });
    expect(o.stats[0].up).toBe('▲8'); // 90% → 98%
    expect(o.stats[1].up).toBe('▲0.12');
    const worse = drillOutcome({ run: run(1700, 30), past: [past(1600)], goalAccuracy: 0.95 });
    expect(worse.stats[0].up).toBeUndefined();
    expect(worse.stats[1].up).toBeUndefined();
  });

  it('스승님 한마디는 하게체, 숫자는 실제 값', () => {
    expect(drillOutcome({ run: run(1570), past: [past(1600)], goalAccuracy: 0.95 }).sage).toContain('1.57초');
    expect(drillOutcome({ run: run(1650), past: [past(1570)], goalAccuracy: 0.95 }).sage).toMatch(/0\.08초.*하게\.$/);
  });
});

describe('목표 막대 = 단계 목표 그대로', () => {
  it('세 막대의 비율과 채움', () => {
    const g = {
      stage: 3, attempts: 100, accuracy: 0.97, medianRt: 2400, unseen: 0, passed: false, next: '',
      rule: { reps: 3, accuracy: 0.95, rtMs: 3000 }, enough: 78, total: 100,
      checks: [{ label: '', ok: false, detail: '' }, { label: '', ok: true, detail: '' }, { label: '', ok: true, detail: '' }],
    } as GoalStatus;
    const [rt, reps, acc] = goalBars(g);
    expect(rt).toMatchObject({ label: '반응 3초', ratio: 1, met: true });
    expect(reps).toMatchObject({ label: '칸마다 3회', ratio: 0.78, met: false, text: '78%' });
    expect(acc).toMatchObject({ label: '정확 95%', ratio: 1, met: true, text: '97%' });
  });
});
