import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { MEMORY_EVENTS } from '../data/events';
import { db } from '../db/db';
import { localDayKey } from '../db/analytics';
import { Empty, Panel, Stat, fmtPct } from '../components/ui';
import { Dymo, Folder, Key, KeyLink } from '../components/lp';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export default function EventDetail() {
  const { eventId = '' } = useParams();
  const ev = MEMORY_EVENTS.find((e) => e.id === eventId);

  /* 이 종목으로 남긴 기록만 추린다 (연습·모의 대회) */
  const sessions = useLiveQuery(
    async () => (await db.recallSessions.orderBy('startedAt').reverse().toArray()).filter((s) => s.eventId === eventId),
    [eventId],
    [],
  );

  if (!ev) {
    return (
      <Empty>
        그런 종목이 없습니다.{' '}
        <Link to="/events" className="text-red underline underline-offset-2">목록으로</Link>
      </Empty>
    );
  }

  const open = ev.status === 'ready';
  const best = sessions.reduce<number>((a, s) => {
    const total = s.correct + s.wrong + s.blank;
    return Math.max(a, total ? s.correct / total : 0);
  }, 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex items-center justify-between gap-2">
          <Dymo tone="red" small>기억력 종목</Dymo>
          <KeyLink to="/events" tone="cream" size="sm">종목 목록</KeyLink>
        </div>
        <h1 className="balance mt-4 font-sign text-[40px] leading-[1.05] text-ink">{ev.name}</h1>
        <p className="mt-2 text-[15px] text-ink">{ev.what}</p>
        <p className="mt-1.5 font-typek text-xs text-ink-2">
          대회 기준 — 암기 <b className="tnum text-ink">{ev.memorize}</b> · 회상 <b className="tnum text-ink">{ev.recall}</b>
        </p>
      </header>

      {!open && (
        <Panel title="아직 잠긴 종목입니다">
          <p className="text-sm text-ink-2">
            <b className="text-ink">열려면</b> — {ev.needs}
          </p>
          <p className="mt-2 font-typek text-[11px] text-ink-2">
            준비되는 대로 이 화면의 연습·모의 대회 버튼이 그대로 켜집니다. 종목 자리는 미리 잡아 두었습니다.
          </p>
        </Panel>
      )}

      {/* 빨간 자판은 모의 대회 시작 하나 — 이 화면의 주 동작 */}
      <Folder tab="시작" clip>
        <h2 className="text-xl leading-tight text-ink">연습</h2>
        <p className="mt-1 text-sm text-ink-2">
          시간을 재지 않습니다. 짧게 내고, 다 외우셨으면 넘어갑니다. 채점할 때 <b className="text-ink">이미지 이름</b>과
          궁전을 고르셨으면 <b className="text-ink">장소 이름</b>까지 같이 보여 줍니다.
        </p>
        <div className="mt-3">
          {open && ev.to ? (
            <KeyLink to={`${ev.to}&run=easy`} size="big">연습 시작</KeyLink>
          ) : (
            <Key size="big" disabled>연습 시작</Key>
          )}
        </div>

        <hr className="my-5 border-dashed border-manila-dark" />

        <h2 className="text-xl leading-tight text-ink">모의 대회</h2>
        <p className="mt-1 text-sm text-ink-2">
          대회 규격 시간으로 잽니다. 암기 시간이 끝나면 자동으로 회상으로 넘어가고, 채점에서 칸마다
          틀린 원인을 달아 둘 수 있습니다.
        </p>
        <div className="mt-3">
          {open && ev.to ? (
            <KeyLink to={`${ev.to}&run=real`} tone="red" size="big">모의 대회 시작</KeyLink>
          ) : (
            <Key tone="red" size="big" disabled>모의 대회 시작</Key>
          )}
        </div>
      </Folder>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Dymo small>내 기록</Dymo>
          {sessions.length > 0 && (
            <span className="font-typek text-xs text-ink-2">
              최고 <b className="tnum text-ink">{fmtPct(best)}</b>
            </span>
          )}
        </div>
        {sessions.length === 0 ? (
          <Panel>
            <Empty>{open ? '아직 이 종목 기록이 없습니다.' : '잠긴 종목이라 기록이 없습니다.'}</Empty>
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="시도" value={`${sessions.length}회`} />
              <Stat label="최고 정확도" value={fmtPct(best)} />
              <div className="col-span-2">
                <Stat
                  label="마지막"
                  value={localDayKey(sessions[0].startedAt)}
                  sub={sessions[0].runMode === 'easy' ? '연습' : '모의 대회'}
                />
              </div>
            </div>
            <Panel>
              <ul className="max-h-64 overflow-auto">
                {sessions.slice(0, 20).map((s) => {
                  const total = s.correct + s.wrong + s.blank;
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 border-t border-card-edge py-1.5 font-typek text-[12.5px] first:border-0"
                    >
                      <span className="tnum text-xs text-ink-2">{localDayKey(s.startedAt)}</span>
                      <span className="rounded-[3px] border border-card-edge px-1.5 text-[11px] text-ink-2">
                        {s.runMode === 'easy' ? '연습' : '모의 대회'}
                      </span>
                      <span className="tnum ml-auto font-bold text-ink">
                        {s.correct}/{total} · {total ? fmtPct(s.correct / total) : '—'}
                      </span>
                      <span className="tnum w-12 text-right text-xs text-ink-2">
                        {mmss(s.memorizeUsedMs + (s.recallUsedMs ?? 0))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </>
        )}
      </section>
    </div>
  );
}
