import type { GoalStatus } from '../db/goals';

/**
 * 통과 여부만 알리지 않고 세 조건을 각각 보여 준다.
 * '언제 끝나나' 에 답이 되어야 하기 때문이다 — 무엇이 남았는지 보이면 남은 거리가 계산된다.
 */
export default function GoalPanel({ goal, celebrate = false }: { goal: GoalStatus; celebrate?: boolean }) {
  if (goal.passed) {
    return (
      <div className="rounded-lg border border-good/50 bg-good/10 px-3 py-2.5">
        <div className="text-sm font-semibold text-good">
          {celebrate ? '목표 도달 — 이 단계는 끝내셔도 됩니다.' : '목표에 도달한 단계입니다.'}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          정확도 {Math.round(goal.accuracy * 100)}% · 중앙 {(goal.medianRt / 1000).toFixed(2)}초 ·
          다음은 <b className="text-fg">{goal.next}</b> 입니다.
        </div>
      </div>
    );
  }

  const done = goal.checks.filter((c) => c.ok).length;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5">
      <div className="mb-1.5 text-xs text-muted">
        목표까지 <span className="tnum text-fg">{done} / {goal.checks.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {goal.checks.map((c) => (
          <li key={c.label} className="flex items-baseline gap-2 text-sm">
            <span className={c.ok ? 'text-good' : 'text-muted'}>{c.ok ? '✓' : '○'}</span>
            <span className={c.ok ? 'text-muted line-through' : ''}>{c.label}</span>
            <span className="tnum ml-auto text-xs text-muted">{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
