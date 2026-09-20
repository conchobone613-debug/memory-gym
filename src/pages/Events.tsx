import { MEMORY_EVENTS } from '../data/events';
import { LinkBtn, Panel } from '../components/ui';

export default function Events() {
  const ready = MEMORY_EVENTS.filter((e) => e.status === 'ready');

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="대회 표준 10종목"
        right={<span className="tnum text-xs text-muted">열림 {ready.length} / {MEMORY_EVENTS.length}</span>}
      >
        <p className="mb-3 text-xs text-muted">
          세계기억력선수권(WMSC)과 국제기억력협회(IAM)가 쓰는 종목입니다. 시간은 연맹과 해에 따라 다르니
          실제 대회에 나가실 땐 그 대회 요강을 보셔야 합니다. 여기 값은 훈련 목표를 잡는 기준입니다.
        </p>

        <ul className="flex flex-col gap-2">
          {MEMORY_EVENTS.map((e) => {
            const open = e.status === 'ready';
            return (
              <li
                key={e.id}
                className={`rounded-lg border px-3 py-2.5 ${
                  open ? 'border-line bg-panel2' : 'border-line/50 bg-transparent'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${open ? '' : 'text-muted'}`}>{e.name}</span>
                  <span className="tnum text-xs text-muted">
                    암기 {e.memorize} · 회상 {e.recall}
                  </span>
                  <span
                    className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] ${
                      open ? 'border-good/50 bg-good/10 text-good' : 'border-line text-muted'
                    }`}
                  >
                    {open ? '열림' : '잠김'}
                  </span>
                  {open && e.to && (
                    <LinkBtn to={e.to} size="sm" variant="primary">
                      하러 가기
                    </LinkBtn>
                  )}
                </div>

                <p className={`mt-1 text-sm ${open ? 'text-muted' : 'text-muted/70'}`}>{e.what}</p>

                {!open && e.needs && (
                  <p className="mt-1.5 rounded-md border border-line/60 px-2 py-1 text-xs text-muted">
                    <b className="text-fg">열려면</b> — {e.needs}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="대회와 다른 점 하나">
        <p className="text-sm text-muted">
          대회는 <b className="text-fg">정해진 시간 안에 최대한 많이</b> 외우는 방식입니다. 반면 지금 실전 모드는
          <b className="text-fg"> 길이를 정해 놓고 시간을 잽니다</b>. 방향이 반대라, 열린 종목도 이 점에서는
          대회와 같지 않습니다. 기록을 대회 성적과 바로 견주지는 마십시오.
        </p>
      </Panel>
    </div>
  );
}
