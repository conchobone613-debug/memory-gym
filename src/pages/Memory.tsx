import { useLiveQuery } from 'dexie-react-hooks';
import { MEMORY_EVENTS } from '../data/events';
import { LADDERS, goalFor } from '../db/goals';
import { Dymo, IndexCard } from '../components/lp';

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

  return (
    <div className="flex flex-col gap-2.5">
      <Dymo tone="red" className="mb-1 self-start">기억력</Dymo>
      <IndexCard
        to="/basics"
        title="기초"
        meta={`통과 ${passed}/${basics.levels.length}`}
        body="숫자를 보면 자음이, 자음이 모이면 이미지가 떠오르게. 모든 종목이 이 위에 섭니다."
      />
      <IndexCard
        to="/events"
        title="종목"
        meta={`열림 ${ready}/${MEMORY_EVENTS.length}`}
        body="대회 종목을 연습하고, 규격대로 모의 대회를 치릅니다."
      />
    </div>
  );
}
