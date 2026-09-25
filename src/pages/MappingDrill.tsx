import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings, type MappingAttempt, type MappingStat } from '../db/db';
import { buildMappingQueue, mappingStatsFor, recordMapping, undoMapping } from '../db/mapping';
import { goalFor } from '../db/goals';
import { loadSummaries } from '../db/sessions';
import { drillOutcome } from '../db/drillOutcome';
import { makeQuestion, statKey, type Direction, type Question, type Stage } from '../lib/mapping';
import type { RunOutcome } from '../lib/outcome';
import { jamoFromKey } from '../lib/keyjamo';
import { uid } from '../lib/random';
import { median } from '../lib/srs';
import { streaks } from '../lib/streak';
import { isTyping } from '../App';
import { Btn, Empty, Field, Panel, Stat, fmtMs, fmtPct } from '../components/ui';
import { Held, Hud, Key, QuestionCard, ResultSheet, useJudge } from '../components/lp';
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

const DIRS = [
  { v: 'toConsonant' as const, t: '숫자 → 자음' },
  { v: 'toDigit' as const, t: '자음 → 숫자' },
  { v: 'mix' as const, t: '섞기' },
];

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
  const [streak, setStreak] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [undoing, setUndoing] = useState(false);
  /** 성적표 — 한 판을 끝내고 기록을 저장한 뒤에 만든다 */
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const t0 = useRef(0);
  const sessionStart = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  /** 끝내기가 겹치지 않게 — 저장·집계를 기다리는 사이 Enter 가 한 번 더 들어와도 성적표를 두 번 만들지 않는다 */
  const finishing = useRef(false);
  const answering = useRef(false);

  /*
   * 판정 연출은 연출 층과 머리띠(계수기·판정 글자·연필 표시)에서만 돈다.
   * 문제 카드는 조각이 넘지 않을 선을 재는 데만 넘기고, 카드에는 아무것도 걸지 않는다(측정 구간).
   */
  const judge = useJudge();
  const { show: showJudge, shake, reset: resetJudge } = judge;
  const cardRef = useRef<HTMLDivElement>(null);

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
    setOutcome(null);
    finishing.current = false;
    resetJudge();
    setPhase('asking');
  };

  const finish = useCallback(async (final: Result[]) => {
    if (finishing.current) return;
    finishing.current = true;
    const now = Date.now();
    if (sessionId) await db.mappingSessions.update(sessionId, { endedAt: now });
    if (final.length > 0) {
      /* 성적표: 기록을 저장한 뒤의 단계 목표 + 같은 단계의 지난 세션(이번 판 제외, 최근 것이 앞) */
      const [g, all] = await Promise.all([goalFor(stage), loadSummaries()]);
      /* 평균 반응시간은 통합 기록(sessions.ts)과 같은 방식 — 모름(0)을 뺀 평균. 지난 판과 같은 잣대로 비교한다 */
      const rts = final.map((r) => r.rtMs).filter((x) => x > 0);
      setOutcome(drillOutcome({
        run: {
          items: final.length,
          correct: final.filter((r) => r.isCorrect).length,
          meanRtMs: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0,
          maxStreak: streaks(final.map((r) => r.isCorrect)).best,
          totalMs: now - sessionStart.current,
        },
        goal: g,
        past: all.filter((s) => s.disciplineId === `basics-${stage}` && s.id !== sessionId),
        goalAccuracy: g.rule.accuracy,
      }));
    }
    setResults(final);
    setPhase('done');
  }, [sessionId, stage]);

  const answer = useCallback(
    async (given: string, giveUp = false) => {
      const cur = queue[idx];
      /*
       * 끝내는 중(성적표 저장·집계를 기다리는 사이)에 들어온 입력은 버린다 — 같은 문제가 한 번 더 기록되지 않게.
       * 저장을 기다리는 사이 들어온 두 번째 입력(키패드 두 번 누름·키 자동 반복)도 같은 문제를 다시 채점해
       * 두 번 기록됐다(2026-09-25 실측). 이 판정이 화면에 반영될 때까지 다음 입력을 받지 않는다.
       */
      if (!cur || finishing.current || answering.current) return;
      answering.current = true;
      /*
       * '모름' 은 오답으로 센다. 반응시간은 0 으로 둬 표본에서 빠진다 — 포기까지 걸린 시간은
       * 회상 속도가 아니다. giveUp 을 따로 두는 이유: 빈 문자열은 `'ㄱㅋㄲ'.includes('')` 가
       * true 라 그냥 넣으면 정답으로 채점된다.
       */
      const rtMs = giveUp ? 0 : Math.round(performance.now() - t0.current);
      const isCorrect = !giveUp && (cur.groups
        ? cur.groups.every((g, i) => g.includes(given[i] ?? ''))
        : given === cur.answer);
      const nextStreak = isCorrect ? streak + 1 : 0;
      /* 판정 연출·소리는 입력 즉시 — 기록 저장을 기다리지 않는다 */
      showJudge(isCorrect ? 'good' : giveUp ? 'skip' : 'bad', nextStreak, cardRef.current);
      const attempt: MappingAttempt = {
        id: uid(), sessionId, order: idx, stage, unit: cur.unit, direction: cur.direction,
        prompt: cur.prompt, answer: cur.answer, given, isCorrect, rtMs, shownAt: Date.now(),
      };
      let prevStat: Awaited<ReturnType<typeof recordMapping>>;
      try {
        prevStat = await recordMapping(attempt);
      } catch (e) {
        answering.current = false;
        throw e;
      }
      const r: Result = { q: cur, given, isCorrect, rtMs, attemptId: attempt.id, prevStat };
      const next = [...results, r];
      setResults(next);
      setTyped('');
      setStreak(nextStreak);
      if (isCorrect) {
        /* 맞으면 멈추지 않는다. 틀렸을 때만 정답을 보여주고 붙잡는다. */
        if (idx + 1 >= queue.length) await finish(next);
        else setIdx(idx + 1);
      } else {
        setLast(r);
        setPhase('feedback');
        /* 붙잡힌 뒤(측정이 끝난 뒤)에만 카드를 한 번 흔든다 */
        if (!giveUp) shake(cardRef.current);
      }
    },
    [finish, idx, queue, results, sessionId, shake, showJudge, stage, streak],
  );

  /* 판정이 화면에 그려진 뒤(다음 문항·붙잡힘·결과로 바뀐 뒤)에야 다음 입력을 받는다 */
  useEffect(() => { answering.current = false; }, [idx, phase, results]);

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
    /* 끝내는 중에는 받지 않는다 — 지운 시도가 성적표에 남는다. 결과 화면에서 되돌리는 것은 된다 */
    if (undoing || (finishing.current && phase !== 'done')) return;
    const last = results[results.length - 1];
    if (!last) return;
    setUndoing(true);
    try {
      await undoMapping(last.attemptId, statKey(stage, last.q.unit), last.prevStat);
      if (phase === 'done' && sessionId) await db.mappingSessions.update(sessionId, { endedAt: undefined });
      const rest = results.slice(0, -1);
      setResults(rest);
      setStreak(streaks(rest.map((r) => r.isCorrect)).cur);
      setIdx(rest.length);
      setTyped('');
      setLast(null);
      finishing.current = false;
      setPhase('asking');
    } finally {
      setUndoing(false);
    }
  }, [phase, results, sessionId, stage, undoing]);

  const pass = useCallback(() => {
    if (phase === 'asking') answer('', true);
  }, [answer, phase]);

  /**
   * 지우기 — 한 글자만.
   * 빈 칸일 때 앞 문제로 보내 봤더니 글자를 지우다가 한 번 더 눌리면 그대로 넘어가 버렸다.
   * 앞 문제는 '← 앞 문제' 를 눌러야만 간다.
   */
  const back = useCallback(() => setTyped((t) => t.slice(0, -1)), []);

  useEffect(() => {
    if (phase === 'asking') t0.current = performance.now();
  }, [phase, idx]);

  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const t = setInterval(() => setElapsed(Date.now() - sessionStart.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  /*
   * 단축키 — 자음은 자판의 자음 키, 숫자는 숫자 키를 직접 누른다.
   * 결과 화면의 키(공개 중 아무 키 = 건너뛰기, 끝난 뒤 Enter = 한 판 더)는 ResultSheet 가 맡는다.
   */
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

      if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
      if (e.key === 'Tab') { e.preventDefault(); pass(); return; }

      const ch = q.groups ? jamoFromKey(e) : (/^[0-9]$/.test(e.key) ? e.key : null);
      if (!ch) return;
      e.preventDefault();
      push(ch);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, continueAfterWrong, finish, pass, phase, push, q, results]);

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    const seen = stats.size;
    const total = stage === 1 ? 10 : 100;
    return (
      <div className="flex flex-col gap-4">
      {header}
      <Panel title={STAGE_TITLE[stage]}>
        {settings && (
          <div className="mb-4">
            <ChosungKey map={settings.chosungMap} compact={stage === 2} />
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-2">
          <Stat label="익힌 칸" value={`${seen}/${total}`} />
          <Stat label="정확도" value={goal?.attempts ? fmtPct(goal.accuracy) : '—'} />
          <Stat label="중앙 반응시간" value={fmtMs(goal?.medianRt ?? 0)} />
          <Stat label="푼 문제" value={goal?.attempts ?? 0} />
        </div>

        {goal && <div className="mb-4"><GoalPanel goal={goal} /></div>}

        <div className="mb-5">
          <div className="mb-2 font-typek text-[11px] font-bold tracking-wide text-ink-2">방향</div>
          <div className="flex flex-wrap gap-x-3 gap-y-4" role="group" aria-label="방향">
            {DIRS.map((o) => (
              <Key
                key={o.v}
                tone={dir === o.v ? 'ink' : 'cream'}
                size="sm"
                aria-pressed={dir === o.v}
                onClick={() => chooseDir(o.v)}
              >
                {o.t}
              </Key>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Field label="문항 수">
            <input
              className="tnum w-28"
              type="number"
              min={5}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </Field>
          <Key tone="red" size="big" onClick={start}>시작</Key>
        </div>

      </Panel>
      </div>
    );
  }

  /* ───────── 결과 ───────── */
  if (phase === 'done') {
    if (results.length === 0 || !outcome) {
      return (
        <div className="flex flex-col gap-4">
          {header}
          <Panel title={STAGE_TITLE[stage]}>
            <Empty>기록된 문항이 없습니다.</Empty>
            <div className="flex flex-wrap gap-x-3 gap-y-4">
              <Btn variant="primary" onClick={start}>한 번 더</Btn>
              <Btn onClick={() => setPhase('setup')}>설정으로</Btn>
            </div>
          </Panel>
        </div>
      );
    }
    const correct = results.filter((r) => r.isCorrect);
    const wrongs = results.filter((r) => !r.isCorrect);
    /*
     * 성적표(글자판·목표 막대·금별·도장·아까움·신기록 무대)는 ResultSheet 가 그린다.
     * 신기록 무대가 화면 뒤를 덮으므로 함께 볼 상세는 children 으로 넘긴다 — 단계 탭도 그래서 성적표 밖이 아니라 맨 끝에 둔다.
     * 목표 막대도 성적표에 있으므로 GoalPanel 은 도달했을 때의 한마디(다음 단계)만.
     */
    return (
      <ResultSheet
        outcome={outcome}
        onAgain={start}
        actions={
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-4 pt-1">
            <Btn onClick={() => setPhase('setup')}>설정으로</Btn>
            <Btn disabled={undoing} onClick={undo}>← 마지막 문제 다시 풀기</Btn>
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="문항" value={results.length} sub={`맞힘 ${correct.length}`} />
          <Stat label="중앙 반응시간" value={fmtMs(median(correct.map((r) => r.rtMs)))} />
          <Stat label="틀린 칸" value={wrongs.length} />
        </div>

        {goal?.passed && <GoalPanel goal={goal} celebrate />}

        {wrongs.length > 0 && (
          <Panel title="틀린 문제">
            <ul className="flex flex-col">
              {wrongs.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 border-b border-card-edge py-1.5 font-typek text-[13px] last:border-b-0">
                  <span className="tnum min-w-10 text-[17px] font-bold text-ink">{r.q.prompt}</span>
                  <span className="text-ink-2">→</span>
                  <span className="text-ink">{r.q.answer}</span>
                  <span className="ml-auto text-blue">{r.given ? `입력 ${r.given}` : '모름'}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {header}
      </ResultSheet>
    );
  }

  /* ───────── 실행 ───────── */
  if (!q) return null;
  const held = phase === 'feedback' && last ? last : null;
  const showing = held ? held.q : q;
  /* 입력 칸 — 모양은 고정, 글자만 바뀐다. 붙잡힌 동안에는 방금 입력한 답을 그대로 둔다 */
  const slots = q.groups ? q.groups.length : q.answer.length;
  const filled = held ? held.given : typed;

  return (
    <div className="flex flex-col gap-3">
      {judge.layer}

      <div className="flex items-center gap-3">
        {results.length > 0 && (
          <Btn size="sm" disabled={undoing} onClick={undo}>← 앞 문제</Btn>
        )}
        <span className="tnum ml-auto text-[13px] text-ink-2">{mmss(elapsed)}</span>
        <Btn size="sm" onClick={() => finish(results)}>중단 (Esc)</Btn>
      </div>

      <Hud left={<>자음 {stage}단계 · <b>{idx + 1}</b>/{queue.length}</>} streak={streak} judge={judge} />

      {/* 판정 글자 줄은 Hud 가 제 자리를 갖는다 — 카드 윗선을 덮지 않는다 */}
      <QuestionCard
        ref={cardRef}
        prompt={showing.prompt}
        help={`${showing.direction === 'toConsonant' ? '이 숫자의 자음은?' : '이 자음의 숫자는?'} · Tab 모름`}
      >
        <div className="flex gap-3">
          {Array.from({ length: slots }).map((_, i) => (
            <span
              key={i}
              className="grid size-14 place-items-center border-b-2 border-ink-2 bg-input font-type text-[28px] font-bold leading-none text-ink"
            >
              {filled[i] ?? ''}
            </span>
          ))}
        </div>
      </QuestionCard>

      {phase === 'asking' && (
        <>
          <Keypad kind={q.groups ? 'jamo' : 'digit'} onPress={push} onBackspace={back} />
          <div className="flex justify-center pt-1">
            <Key tone="cream" sub="Tab" onClick={pass}>모름</Key>
          </div>
        </>
      )}

      {held && (
        <>
          <Held>
            <div>정답 <b>{held.q.answer}</b></div>
            <div className="mt-0.5">
              {held.given
                ? <>입력한 답 <span className="font-type font-bold text-blue">{held.given}</span></>
                : '모름으로 넘겼습니다'}
            </div>
          </Held>
          <Key size="big" sub="Enter" onClick={continueAfterWrong}>계속</Key>
        </>
      )}
    </div>
  );
}
