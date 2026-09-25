import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { MEMORY_EVENTS } from '../data/events';
import { LADDERS, goalFor } from '../db/goals';
import { Panel } from '../components/ui';

/**
 * 기억력 갈림길. 휴대폰 아래 탭 '기억' 이 여기로 온다.
 * 기초와 종목은 나란히 둔다 — 기초는 여러 종목의 공통 기반이라 어느 한 종목 아래로 넣지 않는다.
 */
export default function Memory() {
  const basics = LADDERS[0];
  const passed = useLiveQuery(
    async () => (await Promise.all(basics.levels.map((l) => goalFor(l.stage)))).filter((g) => g.passed).length,
    [],
    0,
  );
  const ready = MEMORY_EVENTS.filter((e) => e.status === 'ready').length;

  const cards = [
    {
      to: '/basics',
      title: '기초',
      line: `${basics.levels.length}단계 중 ${passed}단계 통과`,
      desc: '숫자를 보면 자음이, 자음이 모이면 이미지가 떠오르게. 모든 종목이 이 위에 섭니다.',
    },
    {
      to: '/events',
      title: '종목',
      line: `표준 ${MEMORY_EVENTS.length}종목 중 ${ready}종목 열림`,
      desc: '대회 종목을 연습하고, 규격대로 모의 대회를 치릅니다.',
    },
  ];

  return (
    <Panel title="기억력">
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="rounded-xl border border-line bg-panel2 p-4 transition hover:border-accent/60">
            <h3 className="font-semibold">{c.title}</h3>
            <div className="tnum mt-0.5 text-xs text-accent">{c.line}</div>
            <p className="mt-1.5 text-sm text-muted">{c.desc}</p>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
