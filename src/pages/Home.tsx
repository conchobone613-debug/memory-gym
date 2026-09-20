import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { dailyRows, localDayKey } from '../db/analytics';
import { goalFor, type GoalStatus } from '../db/goals';
import { LinkBtn, Panel, Stat, fmtMs, fmtPct } from '../components/ui';
import BackupNudge from '../components/BackupNudge';

interface NextStep {
  eyebrow: string;
  title: string;
  why: string;
  to: string;
  cta: string;
}

/**
 * 빈 화면에 0 을 네 개 띄우는 건 성적표지 초대장이 아니다.
 * 첫 화면은 '지금 무엇을 하면 되는지' 한 가지만 말한다.
 */
function pickNext(filled: number, g1?: GoalStatus, g2?: GoalStatus, g3?: GoalStatus): NextStep {
  if (filled === 0) {
    return {
      eyebrow: '여기서부터',
      title: '이미지를 채우십시오',
      why: '숫자마다 무엇을 볼지 정하는 일입니다. 추천 목록을 한 번에 넣을 수 있습니다.',
      to: '/assets/sets',
      cta: '이미지 세트 열기',
    };
  }
  if (!g1?.passed) {
    return {
      eyebrow: '오늘 할 일',
      title: '1단계 · 숫자와 자음',
      why: '숫자를 보면 자음이 바로 나와야 합니다. 여기가 안 붙으면 뒤가 전부 느려집니다.',
      to: '/basics',
      cta: '1단계 시작',
    };
  }
  if (!g2?.passed) {
    return {
      eyebrow: '오늘 할 일',
      title: '2단계 · 두 자리 한 번에',
      why: '1단계는 통과하셨습니다. 이제 두 자리를 한 호흡에 읽습니다.',
      to: '/basics',
      cta: '2단계 시작',
    };
  }
  if (!g3?.passed) {
    return {
      eyebrow: '오늘 할 일',
      title: '3단계 · 이미지 변환',
      why: '자음까지 붙었습니다. 이제 숫자에서 곧장 이미지가 떠올라야 합니다.',
      to: '/basics',
      cta: '3단계 시작',
    };
  }
  return {
    eyebrow: '준비되셨습니다',
    title: '종목으로 나가십시오',
    why: '기초 세 단계를 모두 통과하셨습니다. 이제 시간을 재고 겨룰 차례입니다.',
    to: '/events',
    cta: '종목 고르기',
  };
}

export default function Home() {
  const rows = useLiveQuery(() => dailyRows(7), [], []);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const sessions = useLiveQuery(() => db.recallSessions.orderBy('startedAt').reverse().limit(4).toArray(), [], []);
  const g1 = useLiveQuery(() => goalFor(1), []);
  const g2 = useLiveQuery(() => goalFor(2), []);
  const g3 = useLiveQuery(() => goalFor(3), []);

  const today = rows[rows.length - 1];
  const week = rows.reduce(
    (a, r) => ({ attempts: a.attempts + r.attempts, correct: a.correct + r.correct }),
    { attempts: 0, correct: 0 },
  );
  const rts = rows.filter((r) => r.medianRt > 0).map((r) => r.medianRt);
  const filled = images.filter((i) => i.name.trim()).length;
  const next = pickNext(filled, g1, g2, g3);

  const stages = [
    { n: '1', name: '자음 하나', g: g1 },
    { n: '2', name: '두 자리', g: g2 },
    { n: '3', name: '이미지', g: g3 },
  ];

  return (
    <div className="mg-rise flex flex-col gap-5">
      <BackupNudge />
      {/* 오늘 할 일 한 가지 */}
      <section className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-panel2 via-panel to-panel p-6 md:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative">
          <div className="text-[11px] tracking-[0.2em] text-accent/80">{next.eyebrow}</div>
          <h1 className="balance mt-1.5 font-display text-3xl leading-tight md:text-4xl">{next.title}</h1>
          <p className="balance mt-2 max-w-xl text-sm text-muted md:text-base">{next.why}</p>
          <div className="mt-5">
            <LinkBtn to={next.to} variant="primary" size="lg">{next.cta} →</LinkBtn>
          </div>
        </div>
      </section>

      {/* 기초 세 단계 진도 */}
      <div className="grid gap-3 sm:grid-cols-3">
        {stages.map((s) => {
          const done = s.g?.checks.filter((c) => c.ok).length ?? 0;
          const total = s.g?.checks.length ?? 3;
          const passed = s.g?.passed ?? false;
          return (
            <Link
              key={s.n}
              to="/basics"
              className={`rounded-xl border p-4 transition-colors ${
                passed ? 'border-good/40 bg-good/5' : 'border-line bg-panel hover:border-accent/50'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-2xl ${passed ? 'text-good' : 'text-accent/70'}`}>{s.n}</span>
                <span className="text-sm">{s.name}</span>
                {passed && <span className="ml-auto text-xs text-good">통과</span>}
              </div>
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full transition-[width] duration-500 ${passed ? 'bg-good' : 'bg-accent'}`}
                  style={{ width: `${(done / total) * 100}%` }}
                />
              </div>
              <div className="tnum mt-1.5 text-[11px] text-muted">
                {s.g?.attempts ? `정확도 ${fmtPct(s.g.accuracy)} · ${fmtMs(s.g.medianRt)}` : '아직 기록 없음'}
              </div>
            </Link>
          );
        })}
      </div>

      {/* 숫자는 작게, 아래로 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="오늘 시도" value={today?.attempts ?? 0} sub={today?.attempts ? `정확도 ${fmtPct(today.accuracy)}` : '아직'} />
        <Stat label="이번 주" value={week.attempts} sub={week.attempts ? `정확도 ${fmtPct(week.correct / week.attempts)}` : '아직'} />
        <Stat label="주간 반응시간" value={fmtMs(rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0)} />
        <Stat label="채운 이미지" value={filled} sub={`전체 ${images.length}칸`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="최근 실전">
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">아직 실전 기록이 없습니다.</p>
          ) : (
            <ul className="text-sm">
              {sessions.map((s) => {
                const total = s.correct + s.wrong + s.blank;
                return (
                  <li key={s.id} className="flex items-center gap-2 border-t border-line/60 py-2 first:border-0">
                    <span className="text-xs text-muted">{localDayKey(s.startedAt)}</span>
                    <span className="rounded border border-line px-1.5 text-[11px] text-muted">
                      {s.runMode === 'easy' ? '연습' : '실전'}
                    </span>
                    <span className="flex-1 truncate px-1">{s.presetName}</span>
                    <span className="tnum">{total ? fmtPct(s.correct / total) : '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="빠른 이동">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { to: '/assets', t: '자산', d: '이미지 세트 · 궁전' },
              { to: '/basics', t: '기초', d: '자음 → 이미지' },
              { to: '/events', t: '종목', d: '표준 10종목' },
            ].map((c) => (
              <Link
                key={c.to}
                to={c.to}
                className="rounded-lg border border-line bg-panel2/60 px-3 py-3 transition-colors hover:border-accent/60"
              >
                <div className="font-display">{c.t}</div>
                <div className="mt-0.5 text-[11px] text-muted">{c.d}</div>
              </Link>
            ))}
          </div>

          <details className="mt-4 rounded-lg border border-line/70 px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted">키보드 단축키</summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
              <li>기초 1·2단계: 자판의 자음 키 · 숫자 키 (한/영 무관, 화면 버튼도 있음)</li>
              <li>이미지 드릴: <kbd>Space</kbd> 떠올림 · <kbd>D</kbd> 맞음 · <kbd>F</kbd> 틀림 · <kbd>Esc</kbd> 중단</li>
              <li>세트 편집: 방향키 이동 · <kbd>Enter</kbd> 저장·다음 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 다음 빈칸</li>
              <li>실전: 암기 중 <kbd>Enter</kbd> 조기 종료 · 회상 중 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 제출</li>
              <li>채점: <kbd>1</kbd>–<kbd>4</kbd> 원인 태그 · <kbd>↑</kbd><kbd>↓</kbd> 칸 이동</li>
            </ul>
          </details>
        </Panel>
      </div>
    </div>
  );
}
