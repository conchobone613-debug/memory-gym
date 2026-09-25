import { Link } from 'react-router-dom';
import { CALC_EVENTS } from '../data/events';
import { Panel } from '../components/ui';

/** 계산 종목 목록. 기억력 종목과 같은 틀 — 목록 → 종목 상세(연습 / 모의 대회 / 내 기록). */
export default function Calc() {
  const ready = CALC_EVENTS.filter((e) => e.status === 'ready');

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="계산 종목"
        right={<span className="tnum text-xs text-muted">열림 {ready.length} / {CALC_EVENTS.length}</span>}
      >
        <p className="mb-3 text-xs text-muted">
          암산 대회(MCWC) 종목입니다. 규정 값은 설정에서 바꿀 수 있고, 공식 값으로 덮어쓰시면 그대로 따릅니다.
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {CALC_EVENTS.map((e) => {
            const open = e.status === 'ready';
            return (
              <li key={e.id}>
                <Link
                  to={`/calc/${e.id}`}
                  className={`flex h-full flex-col rounded-lg border px-3 py-2.5 transition hover:border-accent/60 ${
                    open ? 'border-line bg-panel2' : 'border-line/50 bg-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${open ? '' : 'text-muted'}`}>{e.name}</span>
                    <span
                      className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] ${
                        open ? 'border-good/50 bg-good/10 text-good' : 'border-line text-muted'
                      }`}
                    >
                      {open ? '열림' : '잠김'}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${open ? 'text-muted' : 'text-muted/70'}`}>{e.what}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
