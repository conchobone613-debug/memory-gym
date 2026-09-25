import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { CALC_EVENTS } from '../data/events';
import { getRules } from '../lib/rules';
import { Btn, Empty, LinkBtn, Panel } from '../components/ui';

export default function CalcDetail() {
  const { id = '' } = useParams();
  const ev = CALC_EVENTS.find((e) => e.id === id);
  const rules = useLiveQuery(() => (ev ? getRules(ev) : Promise.resolve(undefined)), [id]);

  if (!ev) {
    return (
      <Empty>
        그런 종목이 없습니다.{' '}
        <Link to="/calc" className="text-accent">목록으로</Link>
      </Empty>
    );
  }

  const open = ev.status === 'ready';
  const show = (key: string) => {
    const f = ev.rules.find((r) => r.key === key)!;
    const v = rules?.[key];
    if (f.kind === 'choice') return f.options.find((o) => o.value === v)?.label ?? '—';
    if (key === 'timeLimitSec' && v === 0) return '미입력';
    return `${v ?? '—'}${f.unit ? ` ${f.unit}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={ev.name}
        right={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] ${
                open ? 'border-good/50 bg-good/10 text-good' : 'border-line text-muted'
              }`}
            >
              {open ? '열림' : '잠김'}
            </span>
            <LinkBtn to="/calc" size="sm">종목 목록</LinkBtn>
          </div>
        }
      >
        <p className="text-sm text-muted">{ev.what}</p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="연습">
          <p className="text-sm text-muted">난이도를 고르고, 한 문제마다 바로 채점과 풀이를 봅니다.</p>
          <div className="mt-3"><Btn disabled={!open}>연습 시작</Btn></div>
        </Panel>
        <Panel title="모의 대회">
          <p className="text-sm text-muted">아래 규정대로 전체 화면에서 치르고, 끝나면 결과를 봅니다.</p>
          <div className="mt-3"><Btn disabled={!open}>모의 대회 시작</Btn></div>
        </Panel>
      </div>

      <Panel title="규정" right={<LinkBtn to="/settings?at=rules" size="sm">바꾸기</LinkBtn>}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
          {ev.rules.map((f) => (
            <div key={f.key} className="flex flex-col">
              <dt className="text-[11px] text-muted">{f.label}</dt>
              <dd className="tnum">{show(f.key)}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {!open && (
        <Panel title="아직 잠긴 종목입니다">
          <p className="text-sm text-muted">
            <b className="text-fg">열려면</b> — {ev.needs}
          </p>
        </Panel>
      )}

      <Panel title="내 기록">
        <Empty>{open ? '아직 이 종목 기록이 없습니다.' : '잠긴 종목이라 기록이 없습니다.'}</Empty>
      </Panel>
    </div>
  );
}
