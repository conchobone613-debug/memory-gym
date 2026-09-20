import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, type MappingAttempt } from '../db/db';
import { buildMappingQueue, mappingStatsFor, mastery, recordMapping } from '../db/mapping';
import { CHOICE_KEYS, makeQuestion, type Question, type Stage } from '../lib/mapping';
import { uid } from '../lib/random';
import { median } from '../lib/srs';
import { isTyping } from '../App';
import { useNavLock } from '../lib/navlock';
import { Btn, Field, Panel, Stat, fmtMs, fmtPct } from '../components/ui';

type Phase = 'setup' | 'asking' | 'feedback' | 'done';

interface Result {
  q: Question;
  given: string;
  isCorrect: boolean;
  rtMs: number;
}

const STAGE_TITLE: Record<Stage, string> = {
  1: '1단계 · 숫자 하나 ↔ 자음 하나',
  2: '2단계 · 두 자리 ↔ 자음 두 개',
};

export default function MappingDrill({ stage }: { stage: Stage }) {
  const settings = useLiveQuery(() => getSettings(), []);
  const stats = useLiveQuery(() => mappingStatsFor(stage), [stage], new Map());
  const skill = useLiveQuery(() => mastery(stage), [stage]);

  const [count, setCount] = useState(stage === 1 ? 20 : 30);
  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<Result | null>(null);
  const [sessionId, setSessionId] = useState('');

  const t0 = useRef(0);

  useNavLock(phase === 'asking' || phase === 'feedback');

  useEffect(() => {
    setPhase('setup');
    setCount(stage === 1 ? 20 : 30);
  }, [stage]);

  const q = queue[idx];

  const start = async () => {
    if (!settings) return;
    const units = await buildMappingQueue(stage, count);
    const qs = units.map((u) => makeQuestion(stage, u, settings.chosungMap));
    const id = uid();
    await db.mappingSessions.add({ id, stage, startedAt: Date.now(), itemCount: qs.length });
    setSessionId(id);
    setQueue(qs);
    setResults([]);
    setIdx(0);
    setTyped('');
    setLast(null);
    setPhase('asking');
  };

  const finish = useCallback(async (final: Result[]) => {
    if (sessionId) await db.mappingSessions.update(sessionId, { endedAt: Date.now() });
    setResults(final);
    setPhase('done');
  }, [sessionId]);

  const answer = useCallback(
    async (given: string) => {
      const cur = queue[idx];
      if (!cur) return;
      const rtMs = Math.round(performance.now() - t0.current);
      const isCorrect = given === cur.answer;
      const attempt: MappingAttempt = {
        id: uid(), sessionId, order: idx, stage, unit: cur.unit, direction: cur.direction,
        prompt: cur.prompt, answer: cur.answer, given, isCorrect, rtMs, shownAt: Date.now(),
      };
      await recordMapping(attempt);
      const r: Result = { q: cur, given, isCorrect, rtMs };
      const next = [...results, r];
      setResults(next);
      setTyped('');
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

  const continueAfterWrong = useCallback(() => {
    if (idx + 1 >= queue.length) finish(results);
    else { setIdx(idx + 1); setPhase('asking'); }
  }, [finish, idx, queue.length, results]);

  useEffect(() => {
    if (phase === 'asking') t0.current = performance.now();
  }, [phase, idx]);

  /* 단축키 — 보기는 D F J K, 숫자 답은 숫자 키 직접 */
  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(results); return; }

      if (phase === 'feedback') {
        if (e.key === 'Enter' || e.code === 'Space' || e.key === ' ') { e.preventDefault(); continueAfterWrong(); }
        return;
      }
      if (!q) return;

      if (q.choices) {
        const i = CHOICE_KEYS.indexOf(e.key.toLowerCase() as (typeof CHOICE_KEYS)[number]);
        if (i >= 0 && i < q.choices.length) { e.preventDefault(); answer(q.choices[i]); }
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const next = (typed + e.key).slice(-q.answer.length);
        if (next.length === q.answer.length) answer(next);
        else setTyped(next);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setTyped((t) => t.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, continueAfterWrong, finish, phase, q, results, typed]);

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    const seen = stats.size;
    const total = stage === 1 ? 10 : 100;
    return (
      <Panel title={STAGE_TITLE[stage]}>
        <p className="mb-3 text-sm text-muted">
          {stage === 1
            ? '숫자를 보면 자음이, 자음을 보면 숫자가 바로 나올 때까지 합니다. 이미지는 아직 쓰지 않습니다.'
            : '두 자리를 자음 두 개로 한 번에 읽는 연습입니다. 이미지는 그다음입니다.'}
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="익힌 칸" value={`${seen}/${total}`} />
          <Stat label="정확도" value={skill?.attempts ? fmtPct(skill.accuracy) : '—'} />
          <Stat label="중앙 반응시간" value={fmtMs(skill?.medianRt ?? 0)} />
          <Stat label="푼 문제" value={skill?.attempts ?? 0} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="문항 수">
            <input type="number" min={5} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <Btn variant="primary" size="lg" onClick={start}>시작</Btn>
        </div>

        <p className="mt-3 text-xs text-muted">
          자음을 고를 땐 <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> ·
          숫자로 답할 땐 숫자 키를 그냥 누르십시오 · <kbd>Esc</kbd> 중단
        </p>

        {skill?.ready && (
          <p className="mt-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
            정확도 {fmtPct(skill.accuracy)} · {fmtMs(skill.medianRt)} — 다음 단계로 넘어가셔도 됩니다.
          </p>
        )}
      </Panel>
    );
  }

  /* ───────── 결과 ───────── */
  if (phase === 'done') {
    const correct = results.filter((r) => r.isCorrect);
    const rts = correct.map((r) => r.rtMs);
    const wrongs = results.filter((r) => !r.isCorrect);
    return (
      <Panel title={`${STAGE_TITLE[stage]} — 결과`}>
        {results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">기록된 문항이 없습니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="문항" value={results.length} />
              <Stat label="정확도" value={fmtPct(correct.length / results.length)} sub={`${correct.length}/${results.length}`} />
              <Stat label="중앙 반응시간" value={fmtMs(median(rts))} />
              <Stat label="틀린 칸" value={wrongs.length} />
            </div>
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
        <div className="mt-4 flex gap-2">
          <Btn variant="primary" onClick={start}>한 번 더</Btn>
          <Btn onClick={() => setPhase('setup')}>설정으로</Btn>
        </div>
      </Panel>
    );
  }

  /* ───────── 실행 ───────── */
  if (!q) return null;
  const showing = phase === 'feedback' && last ? last.q : q;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tnum">{idx + 1} / {queue.length}</span>
        <div className="mx-4 h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
        </div>
        <button className="text-muted hover:text-fg" onClick={() => finish(results)}>중단 (Esc)</button>
      </div>

      <div className="flex min-h-[20rem] flex-col items-center justify-center gap-6 rounded-xl border border-line bg-panel px-4">
        <span className="text-xs text-muted">
          {showing.direction === 'toConsonant' ? '이 숫자의 자음은?' : '이 자음의 숫자는?'}
        </span>
        <div className="text-center text-[4.5rem] leading-none font-semibold tracking-wider">{showing.prompt}</div>

        {phase === 'asking' && q.choices && (
          <div className="grid w-full max-w-md grid-cols-2 gap-2">
            {q.choices.map((c, i) => (
              <button
                key={c}
                onClick={() => answer(c)}
                className="flex items-center justify-between rounded-lg border border-line bg-panel2 px-3 py-3 text-lg transition hover:border-accent"
              >
                <span>{c}</span>
                <kbd>{CHOICE_KEYS[i].toUpperCase()}</kbd>
              </button>
            ))}
          </div>
        )}

        {phase === 'asking' && !q.choices && (
          <div className="flex flex-col items-center gap-2">
            <div className="tnum flex gap-2">
              {Array.from({ length: q.answer.length }).map((_, i) => (
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
            <span className="text-xs text-muted">숫자 키를 누르십시오</span>
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
        {q.choices ? (
          <>보기는 <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd></>
        ) : (
          <>숫자 키로 답하고 <kbd>Backspace</kbd> 로 지웁니다</>
        )}
      </p>
    </div>
  );
}
