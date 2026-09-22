import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings, type MappingAttempt, type MappingStat } from '../db/db';
import { buildMappingQueue, mappingStatsFor, recordMapping, undoMapping } from '../db/mapping';
import { goalFor } from '../db/goals';
import { makeQuestion, statKey, type Direction, type Question, type Stage } from '../lib/mapping';
import { jamoFromKey } from '../lib/keyjamo';
import { uid } from '../lib/random';
import { median } from '../lib/srs';
import { streaks } from '../lib/streak';
import { isTyping } from '../App';
import { Btn, Field, Panel, Stat, Streak, fmtMs, fmtPct } from '../components/ui';
import Keypad from '../components/Keypad';
import ChosungKey from '../components/ChosungKey';
import GoalPanel from '../components/GoalPanel';

type Phase = 'setup' | 'asking' | 'feedback' | 'done';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

interface Result {
  q: Question;
  given: string;
  isCorrect: boolean;
  rtMs: number;
  /** 되돌리기용 — 지울 원시 기록과 그 전의 통계 */
  attemptId: string;
  prevStat?: MappingStat;
}

const STAGE_TITLE: Record<Stage, string> = {
  1: '1단계 · 숫자 하나 ↔ 자음 하나',
  2: '2단계 · 두 자리 ↔ 자음 두 개',
};

export default function MappingDrill({ stage, header }: { stage: Stage; header?: ReactNode }) {
  const settings = useLiveQuery(() => getSettings(), []);
  const stats = useLiveQuery(() => mappingStatsFor(stage), [stage], new Map());
  const goal = useLiveQuery(() => goalFor(stage), [stage]);

  const [count, setCount] = useState(stage === 1 ? 20 : 30);
  const [dir, setDir] = useState<Direction | 'mix'>('toConsonant');
  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<Result | null>(null);
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [undoing, setUndoing] = useState(false);

  const t0 = useRef(0);
  const sessionStart = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalMs, setTotalMs] = useState(0);

  useEffect(() => {
    setPhase('setup');
    setCount(stage === 1 ? 20 : 30);
  }, [stage]);

  useEffect(() => {
    if (settings) setDir(settings.mappingDirection);
  }, [settings?.mappingDirection]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseDir = async (next: Direction | 'mix') => {
    setDir(next);
    await saveSettings({ mappingDirection: next });
  };

  const q = queue[idx];

  const start = async () => {
    if (!settings) return;
    const units = await buildMappingQueue(stage, count);
    const qs = units.map((u) => makeQuestion(stage, u, settings.chosungMap, dir === 'mix' ? undefined : dir));
    const id = uid();
    await db.mappingSessions.add({ id, stage, startedAt: Date.now(), itemCount: qs.length });
    setSessionId(id);
    setQueue(qs);
    setResults([]);
    setIdx(0);
    setTyped('');
    setLast(null);
    sessionStart.current = Date.now();
    setElapsed(0);
    setStreak(0);
    setBestStreak(0);
    setFlash(null);
    setPhase('asking');
  };

  const finish = useCallback(async (final: Result[]) => {
    const now = Date.now();
    if (sessionId) await db.mappingSessions.update(sessionId, { endedAt: now });
    setTotalMs(now - sessionStart.current);
    setResults(final);
    setPhase('done');
  }, [sessionId]);

  const answer = useCallback(
    async (given: string) => {
      const cur = queue[idx];
      if (!cur) return;
      const rtMs = Math.round(performance.now() - t0.current);
      const isCorrect = cur.groups
        ? cur.groups.every((g, i) => g.includes(given[i] ?? ''))
        : given === cur.answer;
      const attempt: MappingAttempt = {
        id: uid(), sessionId, order: idx, stage, unit: cur.unit, direction: cur.direction,
        prompt: cur.prompt, answer: cur.answer, given, isCorrect, rtMs, shownAt: Date.now(),
      };
      const prevStat = await recordMapping(attempt);
      const r: Result = { q: cur, given, isCorrect, rtMs, attemptId: attempt.id, prevStat };
      const next = [...results, r];
      setResults(next);
      setTyped('');
      setFlash(isCorrect ? 'good' : 'bad');
      setTimeout(() => setFlash(null), 340);
      if (isCorrect) {
        setStreak((v) => { const n = v + 1; setBestStreak((b) => Math.max(b, n)); return n; });
      } else {
        setStreak(0);
      }
      if (isCorrect) {
        /* 맞으면 멈추지 않는다. 틀렸을 때만 정답을 보여주고 붙잡는다. */
        if (idx + 1 >= queue.length) await finish(next);
        else setIdx(idx + 1);
      } else {
        setLast(r);
        setPhase('feedback');
      }
    },
    [finish, idx, queue, results, sessionId, stage],
  );

  /** 키로 누르든 화면을 누르든 같은 길로 들어온다. 휴대폰에는 물리 키가 없다. */
  const push = useCallback((ch: string) => {
    const cur = queue[idx];
    if (!cur || phase !== 'asking') return;
    const want = cur.groups ? cur.groups.length : cur.answer.length;
    const next = (typed + ch).slice(-want);
    if (next.length === want) answer(next);
    else setTyped(next);
  }, [answer, idx, phase, queue, typed]);

  const continueAfterWrong = useCallback(() => {
    if (idx + 1 >= queue.length) finish(results);
    else { setIdx(idx + 1); setPhase('asking'); }
  }, [finish, idx, queue.length, results]);

  /**
   * 한 문제 뒤로 — 손이 미끄러져 엉뚱한 키를 눌렀을 때.
   * 여기는 마지막 자음을 누르는 순간 바로 채점되므로 잡을 틈이 없다.
   * 원시 기록과 통계를 같이 되돌리고 그 문제를 다시 낸다.
   */
  const undo = useCallback(async () => {
    if (undoing) return;
    const last = results[results.length - 1];
    if (!last) return;
    setUndoing(true);
    try {
      await undoMapping(last.attemptId, statKey(stage, last.q.unit), last.prevStat);
      if (phase === 'done' && sessionId) await db.mappingSessions.update(sessionId, { endedAt: undefined });
      const rest = results.slice(0, -1);
      const s = streaks(rest.map((r) => r.isCorrect));
      setResults(rest);
      setStreak(s.cur);
      setBestStreak(s.best);
      setIdx(rest.length);
      setTyped('');
      setLast(null);
      setFlash(null);
      setPhase('asking');
    } finally {
      setUndoing(false);
    }
  }, [phase, results, sessionId, stage, undoing]);

  /** 지우기 — 친 것이 남아 있으면 한 글자, 없으면 앞 문제로. 셸에서 하던 것과 같다. */
  const back = useCallback(() => {
    if (typed) setTyped((t) => t.slice(0, -1));
    else undo();
  }, [typed, undo]);

  useEffect(() => {
    if (phase === 'asking') t0.current = performance.now();
  }, [phase, idx]);

  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const t = setInterval(() => setElapsed(Date.now() - sessionStart.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  /* 단축키 — 보기는 D F J K, 숫자 답은 숫자 키 직접 */
  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(results); return; }

      if (phase === 'feedback') {
        if (e.key === 'Enter' || e.code === 'Space' || e.key === ' ') { e.preventDefault(); continueAfterWrong(); }
        else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
        return;
      }
      if (!q) return;

      if (e.key === 'Backspace') { e.preventDefault(); back(); return; }

      const ch = q.groups ? jamoFromKey(e) : (/^[0-9]$/.test(e.key) ? e.key : null);
      if (!ch) return;
      e.preventDefault();
      push(ch);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, continueAfterWrong, finish, phase, push, q, results, undo]);

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    const seen = stats.size;
    const total = stage === 1 ? 10 : 100;
    return (
      <Panel title={STAGE_TITLE[stage]}>
        <p className="mb-3 text-sm text-muted">
          {stage === 1
            ? '숫자를 보면 자음이 바로 나올 때까지 합니다. 이미지는 아직 쓰지 않습니다.'
            : '두 자리를 자음 두 개로 한 번에 읽는 연습입니다. 이미지는 그다음입니다.'}
        </p>

        {settings && (
          <div className="mb-4">
            <ChosungKey map={settings.chosungMap} compact={stage === 2} />
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="익힌 칸" value={`${seen}/${total}`} />
          <Stat label="정확도" value={goal?.attempts ? fmtPct(goal.accuracy) : '—'} />
          <Stat label="중앙 반응시간" value={fmtMs(goal?.medianRt ?? 0)} />
          <Stat label="푼 문제" value={goal?.attempts ?? 0} />
        </div>

        {goal && <div className="mb-4"><GoalPanel goal={goal} /></div>}

        <div className="mb-4">
          <div className="mb-1 text-xs text-muted">방향</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {([
              { v: 'toConsonant' as const, t: '숫자 → 자음', d: '외울 때 쓰는 방향 · 먼저 이것부터' },
              { v: 'toDigit' as const, t: '자음 → 숫자', d: '회상에서 막혔을 때 되짚는 길' },
              { v: 'mix' as const, t: '섞기', d: '양쪽이 다 붙은 뒤' },
            ]).map((o) => (
              <button
                key={o.v}
                onClick={() => chooseDir(o.v)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  dir === o.v ? 'border-accent bg-accent/15' : 'border-line bg-panel2 hover:border-accent/50'
                }`}
              >
                <div className="text-sm font-medium">{o.t}</div>
                <div className="text-[11px] text-muted">{o.d}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="문항 수">
            <input type="number" min={5} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <Btn variant="primary" size="lg" onClick={start}>시작</Btn>
        </div>

        <p className="mt-3 text-xs text-muted">
          답이 자음이면 자판의 자음 키를, 숫자면 숫자 키를 그냥 누르십시오. 한/영 상태는 상관없습니다.
          지울 땐 <kbd>Backspace</kbd>, 중단은 <kbd>Esc</kbd> 입니다.
          잘못 눌러 넘어갔으면 아무것도 안 친 상태에서 <kbd>Backspace</kbd> 를 누르십시오 — 앞 문제로 돌아갑니다.
        </p>

      </Panel>
    );
  }

  /* ───────── 결과 ───────── */
  if (phase === 'done') {
    const correct = results.filter((r) => r.isCorrect);
    const rts = correct.map((r) => r.rtMs);
    const wrongs = results.filter((r) => !r.isCorrect);
    return (
      <div className="flex flex-col gap-4">
      {header}
      <Panel title={`${STAGE_TITLE[stage]} — 결과`}>
        {results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">기록된 문항이 없습니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
              <Stat label="문항" value={results.length} />
              <Stat label="정확도" value={fmtPct(correct.length / results.length)} sub={`${correct.length}/${results.length}`} />
              <Stat label="총 걸린 시간" value={mmss(totalMs)} sub={`문항당 ${fmtMs(Math.round(totalMs / results.length))}`} />
              <Stat label="중앙 반응시간" value={fmtMs(median(rts))} />
              <Stat label="틀린 칸" value={wrongs.length} />
              <Stat label="최고 연속" value={bestStreak} />
            </div>

            {goal && <div className="mt-4"><GoalPanel goal={goal} celebrate /></div>}
            {wrongs.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs text-muted">틀린 문제</div>
                <ul className="flex flex-wrap gap-1.5">
                  {wrongs.map((r, i) => (
                    <li key={i} className="rounded-md border border-bad/50 bg-bad/10 px-2 py-1 text-sm">
                      <span className="tnum">{r.q.prompt}</span>
                      <span className="text-muted"> → </span>
                      <span className="text-good">{r.q.answer}</span>
                      <span className="text-bad"> (답: {r.given || '—'})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={start}>한 번 더</Btn>
          <Btn onClick={() => setPhase('setup')}>설정으로</Btn>
          {results.length > 0 && (
            <Btn disabled={undoing} onClick={undo}>← 마지막 문제 다시 풀기</Btn>
          )}
        </div>
      </Panel>
      </div>
    );
  }

  /* ───────── 실행 ───────── */
  if (!q) return null;
  const showing = phase === 'feedback' && last ? last.q : q;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tnum">{idx + 1} / {queue.length}</span>
        <span className="tnum ml-3">{mmss(elapsed)}</span>
        <span className="ml-3"><Streak n={streak} /></span>
        <div className="mx-4 h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
        </div>
        {results.length > 0 && (
          <button
            className="mr-3 text-muted transition-colors hover:text-accent disabled:opacity-40"
            disabled={undoing}
            onClick={undo}
          >
            ← 앞 문제
          </button>
        )}
        <button className="text-muted hover:text-fg" onClick={() => finish(results)}>중단 (Esc)</button>
      </div>

      <div
        className={`flex min-h-[20rem] flex-col items-center justify-center gap-6 rounded-xl border px-4 py-6 transition-colors ${
          flash === 'good' ? 'mg-good border-good/70 bg-good/10' :
          flash === 'bad' ? 'mg-bad border-bad/70 bg-bad/10' :
          'border-line bg-panel'
        }`}
      >
        <span className="text-xs text-muted">
          {showing.direction === 'toConsonant' ? '이 숫자의 자음은?' : '이 자음의 숫자는?'}
        </span>
        <div className="text-center text-[4.5rem] leading-none font-semibold tracking-wider">{showing.prompt}</div>

        {phase === 'asking' && (
          <div className="flex flex-col items-center gap-2">
            <div className="tnum flex gap-2">
              {Array.from({ length: q.groups ? q.groups.length : q.answer.length }).map((_, i) => (
                <span
                  key={i}
                  className={`flex size-14 items-center justify-center rounded-lg border text-2xl ${
                    typed[i] ? 'border-accent bg-accent/15' : 'border-line bg-panel2'
                  }`}
                >
                  {typed[i] ?? ''}
                </span>
              ))}
            </div>
            <span className="text-xs text-muted">
              {q.groups ? '자음을 누르십시오' : '숫자를 누르십시오'}
            </span>
            <Keypad
              kind={q.groups ? 'jamo' : 'digit'}
              onPress={push}
              onBackspace={back}
            />
          </div>
        )}

        {phase === 'feedback' && last && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-sm text-bad">답하신 것 — {last.given || '—'}</div>
            <div className="text-4xl font-semibold text-good">{last.q.answer}</div>
            <Btn variant="primary" onClick={continueAfterWrong}>계속 (Enter)</Btn>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        {q.groups
          ? '자판이든 화면이든 편한 쪽으로 누르십시오. 한/영 상태는 상관없습니다.'
          : '자판이든 화면이든 편한 쪽으로 누르십시오.'}
      </p>
    </div>
  );
}
