import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { CALC_EVENTS } from '../data/events';
import { calcSummaries, loadCalcLog } from '../db/calcLog';
import { localDayKey } from '../db/analytics';
import { CAL_LEVELS } from '../calc/calendarLadder';
import { getRules } from '../lib/rules';
import { Empty, Panel, fmtPct } from '../components/ui';
import { Dymo, Folder, Key, KeyLink } from '../components/lp';

export default function CalcDetail() {
  const { id = '' } = useParams();
  const ev = CALC_EVENTS.find((e) => e.id === id);
  const rules = useLiveQuery(() => (ev ? getRules(ev) : Promise.resolve(undefined)), [id]);
  /* 내 기록 — 이 종목 세션(문항이 있는 것), 최근 것이 앞 */
  const log = useLiveQuery(() => (ev?.status === 'ready' ? loadCalcLog(ev.id) : Promise.resolve(undefined)), [id]);

  if (!ev) {
    return (
      <Empty>
        그런 종목이 없습니다.{' '}
        <Link to="/calc" className="text-red underline underline-offset-2">목록으로</Link>
      </Empty>
    );
  }

  const open = ev.status === 'ready';
  const rows = log ? calcSummaries(log).slice(0, 20) : [];
  const byId = new Map(log?.sessions.map((s) => [s.id, s]));
  /** 연습은 칸 이름(달력 사다리), 모의 대회는 점수 — 끝까지 치르지 않은 판은 '중단' */
  const detail = (sid: string) => {
    const s = byId.get(sid);
    if (!s) return '';
    if (s.mode === 'contest') return s.endedAt ? `${s.score}점` : '중단';
    return ev.id === 'calendar' ? CAL_LEVELS.find((l) => l.n === Number(s.params.level))?.name ?? '' : '';
  };
  const show = (key: string) => {
    const f = ev.rules.find((r) => r.key === key)!;
    const v = rules?.[key];
    if (f.kind === 'choice') return f.options.find((o) => o.value === v)?.label ?? '—';
    if (key === 'timeLimitSec' && v === 0) return '미입력';
    return `${v ?? '—'}${f.unit ? ` ${f.unit}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex items-center justify-between gap-2">
          <Dymo tone="blue" small>계산 종목</Dymo>
          <KeyLink to="/calc" tone="cream" size="sm">종목 목록</KeyLink>
        </div>
        <h1 className="balance mt-4 font-sign text-[40px] leading-[1.05] text-ink">{ev.name}</h1>
        <p className="mt-2 text-[15px] text-ink">{ev.what}</p>
      </header>

      {!open && (
        <Panel title="아직 잠긴 종목입니다">
          <p className="text-sm text-ink-2">
            <b className="text-ink">열려면</b> — {ev.needs}
          </p>
        </Panel>
      )}

      {/* 빨간 자판은 모의 대회 시작 하나 — 이 화면의 주 동작 */}
      <Folder tab="시작" clip>
        <h2 className="text-xl leading-tight text-ink">연습</h2>
        <p className="mt-1 text-sm text-ink-2">난이도를 고르고, 한 문제마다 바로 채점과 풀이를 봅니다.</p>
        <div className="mt-3">
          {open && ev.to ? <KeyLink to={ev.to} size="big">연습 시작</KeyLink> : <Key size="big" disabled>연습 시작</Key>}
        </div>

        <hr className="my-5 border-dashed border-manila-dark" />

        <h2 className="text-xl leading-tight text-ink">모의 대회</h2>
        <p className="mt-1 text-sm text-ink-2">아래 규정대로 전체 화면에서 치르고, 끝나면 결과를 봅니다.</p>
        <div className="mt-3">
          {open && ev.to
            ? <KeyLink to={`${ev.to}?mode=contest`} tone="red" size="big">모의 대회 시작</KeyLink>
            : <Key tone="red" size="big" disabled>모의 대회 시작</Key>}
        </div>
      </Folder>

      <Panel title="규정" right={<KeyLink to="/settings?at=rules" tone="cream" size="sm">바꾸기</KeyLink>}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {ev.rules.map((f) => (
            <div key={f.key} className="flex flex-col">
              <dt className="font-typek text-[11px] text-ink-2">{f.label}</dt>
              <dd className="tnum text-[15px] font-bold text-ink">{show(f.key)}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <section className="flex flex-col gap-2.5">
        <Dymo small className="self-start">내 기록</Dymo>
        <Panel>
          {rows.length === 0 ? (
            <Empty>{open ? '아직 이 종목 기록이 없습니다.' : '잠긴 종목이라 기록이 없습니다.'}</Empty>
          ) : (
            <ul className="max-h-64 overflow-auto">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center gap-2 border-t border-card-edge py-1.5 font-typek text-[12.5px] first:border-0">
                  <span className="tnum text-xs text-ink-2">{localDayKey(s.startedAt)}</span>
                  <span className="rounded-[3px] border border-card-edge px-1.5 text-[11px] text-ink-2">
                    {s.mode === 'contest' ? '모의 대회' : '연습'}
                  </span>
                  <span className="truncate text-ink">{detail(s.id)}</span>
                  <span className="tnum ml-auto font-bold text-ink">{fmtPct(s.accuracy)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}
