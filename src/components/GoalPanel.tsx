import type { CSSProperties } from 'react';
import type { GoalStatus } from '../db/goals';
import { goalBars } from '../db/drillOutcome';

/**
 * 통과 여부만 알리지 않고 세 조건을 각각 보여 준다.
 * '언제 끝나나' 에 답이 되어야 하기 때문이다 — 무엇이 남았는지 보이면 남은 거리가 계산된다.
 *
 * 모양은 성적표의 목표 막대(lp-bar)와 같고 막대 값도 같은 goalBars 에서 온다 — 설정·결과·기록 세 곳이
 * 한 기준으로 보인다. 빨간 세로선이 목표다.
 */
export default function GoalPanel({ goal, celebrate = false }: { goal: GoalStatus; celebrate?: boolean }) {
  /* 결과 화면: 성적표가 막대를 이미 보여 주므로 도달했다는 말과 다음 단계만 */
  if (goal.passed && celebrate) {
    return (
      <div className="lp-stat font-typek text-[13px] text-ink">
        <b className="text-chalk">목표 도달 — 이 단계는 끝내셔도 됩니다.</b>
        <div className="mt-0.5 text-[12px] text-ink-2">다음은 <b className="text-ink">{goal.next}</b>입니다.</div>
      </div>
    );
  }

  const bars = goalBars(goal);
  /* '칸마다 n회' 는 비율보다 남은 칸 수가 거리를 더 잘 말해 준다 */
  bars[1] = { ...bars[1], text: goal.total ? `${goal.enough}/${goal.total}칸` : '—' };
  const done = goal.checks.filter((c) => c.ok).length;

  return (
    <div className="lp-stat">
      <div className="flex items-baseline justify-between gap-2 font-typek text-[12px] font-bold text-ink-2">
        <span className={goal.passed ? 'text-chalk' : undefined}>{goal.passed ? '목표에 도달한 단계입니다' : '목표까지'}</span>
        <span className="tnum text-ink">{done}/{goal.checks.length}</span>
      </div>
      <div className="lp-bars">
        {bars.map((b) => (
          /* 오른쪽 칸은 '12/100칸' 이 들어가도록 글자 폭만큼 */
          <div key={b.label} className="lp-bar" style={{ gridTemplateColumns: '64px 1fr auto' }}>
            <span>{b.label}</span>
            <span className="lp-bar-track">
              <span className="lp-bar-fill" style={{ '--w': b.ratio } as CSSProperties} />
              <span className="lp-bar-goal" />
            </span>
            <span className="lp-bar-num">{b.text}</span>
          </div>
        ))}
      </div>
      {goal.passed && (
        <div className="mt-2 font-typek text-[12px] text-ink-2">다음은 <b className="text-ink">{goal.next}</b>입니다.</div>
      )}
    </div>
  );
}
