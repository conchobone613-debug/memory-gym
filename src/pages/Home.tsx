import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { dailyRows, localDayKey } from '../db/analytics';
import { Panel, Stat, fmtMs, fmtPct } from '../components/ui';

const CARDS = [
  { to: '/drill', key: '3', title: '변환 드릴', desc: '1단계 자음 → 2단계 자음 두 개 → 3단계 이미지.' },
  { to: '/practice', key: '4', title: '실전', desc: '숫자 80자리 · 카드 52장. 암기 → 회상 → 채점.' },
  { to: '/events', key: '5', title: '대회 종목', desc: '표준 10종목. 지금 되는 것과 아직 잠긴 것.' },
];

export default function Home() {
  const rows = useLiveQuery(() => dailyRows(7), [], []);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const sessions = useLiveQuery(() => db.recallSessions.orderBy('startedAt').reverse().limit(5).toArray(), [], []);

  const today = rows[rows.length - 1];
  const week = rows.reduce(
    (a, r) => ({ attempts: a.attempts + r.attempts, correct: a.correct + r.correct }),
    { attempts: 0, correct: 0 },
  );
  const rts = rows.filter((r) => r.medianRt > 0).map((r) => r.medianRt);
  const filled = images.filter((i) => i.name.trim()).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="오늘 시도" value={today?.attempts ?? 0} sub={today ? `정확도 ${today.attempts ? fmtPct(today.accuracy) : '—'}` : ''} />
        <Stat label="이번 주 시도" value={week.attempts} sub={week.attempts ? `정확도 ${fmtPct(week.correct / week.attempts)}` : ''} />
        <Stat label="주간 중앙 반응시간" value={fmtMs(rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0)} />
        <Stat label="채운 이미지" value={filled} sub={`전체 키 ${images.length}`} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="rounded-xl border border-line bg-panel p-4 transition hover:border-accent/60"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{c.title}</h3>
              <kbd>{c.key}</kbd>
            </div>
            <p className="mt-1 text-sm text-muted">{c.desc}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="최근 실전">
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">아직 실전 기록이 없습니다.</p>
          ) : (
            <ul className="text-sm">
              {sessions.map((s) => {
                const total = s.correct + s.wrong + s.blank;
                return (
                  <li key={s.id} className="flex items-center justify-between border-t border-line/60 py-1.5 first:border-0">
                    <span className="text-muted">{localDayKey(s.startedAt)}</span>
                    <span className="flex-1 px-3 truncate">{s.presetName}</span>
                    <span className="tnum">{s.correct}/{total} · {total ? fmtPct(s.correct / total) : '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="조작">
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            <li><kbd>1</kbd>–<kbd>8</kbd> 화면 이동</li>
            <li>드릴 3단계: <kbd>Space</kbd> 떠올림 · <kbd>D</kbd> 맞음 · <kbd>F</kbd> 틀림 · <kbd>Esc</kbd> 중단</li>
            <li>드릴 1·2단계: 자음 답은 자판의 자음 키 · 숫자 답은 숫자 키 (한/영 무관)</li>
            <li>세트 편집: 방향키 이동 · <kbd>Enter</kbd> 저장·다음 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 다음 빈칸</li>
            <li>실전: 암기 중 <kbd>Enter</kbd> 조기 종료 · 회상 중 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 제출</li>
            <li>채점: <kbd>1</kbd>–<kbd>4</kbd> 원인 태그 · <kbd>↑</kbd><kbd>↓</kbd> 칸 이동</li>
            <li>워크스루: <kbd>Space</kbd> 가리기 · <kbd>→</kbd> 다음</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
