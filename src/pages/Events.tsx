import { MEMORY_EVENTS, needsHead } from '../data/events';
import { Panel } from '../components/ui';
import { Dymo, IndexCard } from '../components/lp';


/** 카드 오른쪽 수치 칸에는 앞쪽 '숫자+단위'만('5분 안에 최대한 빨리' → '5분'). 숫자가 없으면 비운다. */
const memorizeShort = (s: string) => /^\d+(분|초)/.exec(s)?.[0];

export default function Events() {
  const ready = MEMORY_EVENTS.filter((e) => e.status === 'ready');

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Dymo tone="red">기억력 종목</Dymo>
          <span className="font-typek text-xs text-ink-2">
            열림 <b className="tnum text-ink">{ready.length}/{MEMORY_EVENTS.length}</b>
          </span>
        </div>
        <p className="font-typek text-[11px] text-ink-2">
          오른쪽은 암기 시간입니다. 국제 기억력 대회 기준이며 연맹과 해에 따라 다릅니다.
        </p>
        {MEMORY_EVENTS.map((e) => {
          const locked = e.status !== 'ready';
          return (
            <IndexCard
              key={e.id}
              to={`/events/${e.id}`}
              title={e.name}
              meta={memorizeShort(e.memorize)}
              body={locked ? `열려면: ${needsHead(e.needs)}` : e.what}
              locked={locked}
            />
          );
        })}
      </section>

      <Panel title="대회와 다른 점 하나">
        <p className="text-sm text-ink-2">
          대회는 <b className="text-ink">정해진 시간 안에 최대한 많이</b> 외우는 방식입니다. 반면 지금 모의 대회는
          <b className="text-ink"> 길이를 정해 놓고 시간을 잽니다</b>. 방향이 반대라, 열린 종목도 이 점에서는
          대회와 같지 않습니다. 기록을 대회 성적과 바로 견주지는 마십시오.
        </p>
      </Panel>
    </div>
  );
}
