import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { MEMORY_EVENTS } from '../data/events';
import { db } from '../db/db';
import { localDayKey } from '../db/analytics';
import { Btn, Empty, LinkBtn, Panel, Stat, fmtPct } from '../components/ui';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export default function EventDetail() {
  const { eventId = '' } = useParams();
  const ev = MEMORY_EVENTS.find((e) => e.id === eventId);

  /* 이 종목으로 남긴 실전 기록만 추린다 */
  const sessions = useLiveQuery(
    async () => (await db.recallSessions.orderBy('startedAt').reverse().toArray()).filter((s) => s.eventId === eventId),
    [eventId],
    [],
  );

  if (!ev) {
    return (
      <Empty>
        그런 종목이 없습니다.{' '}
        <Link to="/events" className="text-accent">목록으로</Link>
      </Empty>
    );
  }

  const open = ev.status === 'ready';
  const best = sessions.reduce<number>((a, s) => {
    const total = s.correct + s.wrong + s.blank;
    return Math.max(a, total ? s.correct / total : 0);
  }, 0);

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
            <LinkBtn to="/events" size="sm">종목 목록</LinkBtn>
          </div>
        }
      >
        <p className="text-sm text-muted">{ev.what}</p>
        <div className="tnum mt-2 text-xs text-muted">
          대회 기준 — 암기 {ev.memorize} · 회상 {ev.recall}
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="연습">
          <p className="text-sm text-muted">
            시간을 재지 않습니다. 짧게 내고, 다 외우셨으면 넘어갑니다. 채점할 때 <b className="text-fg">이미지 이름</b>과
            궁전을 고르셨으면 <b className="text-fg">장소 이름</b>까지 같이 보여 줍니다.
          </p>
          <div className="mt-3">
            {open && ev.to ? (
              <LinkBtn to={`${ev.to}&run=easy`} variant="primary">연습 시작</LinkBtn>
            ) : (
              <Btn disabled>연습 시작</Btn>
            )}
          </div>
        </Panel>

        <Panel title="실전">
          <p className="text-sm text-muted">
            대회 규격 시간으로 잽니다. 암기 시간이 끝나면 자동으로 회상으로 넘어가고, 채점에서 칸마다
            틀린 원인을 달아 둘 수 있습니다.
          </p>
          <div className="mt-3">
            {open && ev.to ? (
              <LinkBtn to={`${ev.to}&run=real`} variant="primary">실전 시작</LinkBtn>
            ) : (
              <Btn disabled>실전 시작</Btn>
            )}
          </div>
        </Panel>
      </div>

      {!open && (
        <Panel title="아직 잠긴 종목입니다">
          <p className="text-sm text-muted">
            <b className="text-fg">열려면</b> — {ev.needs}
          </p>
          <p className="mt-2 text-xs text-muted">
            준비되는 대로 이 화면의 연습·실전 버튼이 그대로 켜집니다. 종목 자리는 미리 잡아 두었습니다.
          </p>
        </Panel>
      )}

      <Panel
        title="내 기록"
        right={sessions.length > 0 ? <span className="tnum text-xs text-muted">최고 {fmtPct(best)}</span> : undefined}
      >
        {sessions.length === 0 ? (
          <Empty>{open ? '아직 이 종목 기록이 없습니다.' : '잠긴 종목이라 기록이 없습니다.'}</Empty>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3">
              <Stat label="시도" value={sessions.length} />
              <Stat label="최고 정확도" value={fmtPct(best)} />
              <Stat
                label="마지막"
                value={localDayKey(sessions[0].startedAt)}
                sub={sessions[0].runMode === 'easy' ? '연습' : '실전'}
              />
            </div>
            <ul className="max-h-64 overflow-auto text-sm">
              {sessions.slice(0, 20).map((s) => {
                const total = s.correct + s.wrong + s.blank;
                return (
                  <li key={s.id} className="flex items-center gap-2 border-t border-line/60 py-1.5 first:border-0">
                    <span className="text-xs text-muted">{localDayKey(s.startedAt)}</span>
                    <span className="rounded border border-line px-1.5 text-[11px] text-muted">
                      {s.runMode === 'easy' ? '연습' : '실전'}
                    </span>
                    <span className="tnum ml-auto">
                      {s.correct}/{total} · {total ? fmtPct(s.correct / total) : '—'}
                    </span>
                    <span className="tnum w-14 text-right text-xs text-muted">
                      {mmss(s.memorizeUsedMs + (s.recallUsedMs ?? 0))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}
