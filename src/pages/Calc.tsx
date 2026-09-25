import { useLiveQuery } from 'dexie-react-hooks';
import { CALC_EVENTS, needsHead } from '../data/events';
import { getRules } from '../lib/rules';
import { Dymo, IndexCard } from '../components/lp';


/** 제한시간 표기 — 60초는 1분, 0 은 아직 공식 값을 넣지 않은 것 */
const limitText = (sec: number | string | undefined) => {
  const n = Number(sec);
  if (!n) return '—';
  return n % 60 ? `${n}초` : `${n / 60}분`;
};

/** 계산 종목 목록. 기억력 종목과 같은 틀 — 목록 → 종목 상세(연습 / 모의 대회 / 내 기록). */
export default function Calc() {
  const ready = CALC_EVENTS.filter((e) => e.status === 'ready');
  /* 카드 오른쪽 제한시간은 설정에서 바꾼 규정을 따른다 */
  const rules = useLiveQuery(() => Promise.all(CALC_EVENTS.map((e) => getRules(e))), [], []);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <Dymo tone="blue">계산 종목</Dymo>
        <span className="font-typek text-xs text-ink-2">
          열림 <b className="tnum text-ink">{ready.length}/{CALC_EVENTS.length}</b>
        </span>
      </div>
      <p className="font-typek text-[11px] text-ink-2">
        세계 암산 대회 종목입니다. 오른쪽은 제한시간입니다. 규정 값은 설정에서 바꿀 수 있고, 공식 값으로
        덮어쓰시면 그대로 따릅니다.
      </p>
      {CALC_EVENTS.map((e, i) => {
        const locked = e.status !== 'ready';
        return (
          <IndexCard
            key={e.id}
            to={`/calc/${e.id}`}
            title={e.name}
            meta={rules[i] ? limitText(rules[i].timeLimitSec) : undefined}
            body={locked ? `열려면: ${needsHead(e.needs)}` : e.what}
            locked={locked}
          />
        );
      })}
    </section>
  );
}
