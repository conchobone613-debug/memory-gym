import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { db, type RuleValues } from '../db/db';
import { calcSummaries, loadCalcLog } from '../db/calcLog';
import { CALC_EVENTS, type CalcEvent, type RuleField } from '../data/events';
import { getRules } from '../lib/rules';
import { uid } from '../lib/random';
import { streaks } from '../lib/streak';
import type { OutcomeGoal, RunOutcome } from '../lib/outcome';
import { reduced } from '../design/settings';
import { isTyping } from '../App';
import { appendAnswer, normalizeAnswer, promptSize, type Problem } from '../calc/problem';
import { CALC_MAKERS, type CalcMaker } from '../calc/makers';
import {
  calcLadderStatus, calcLevelItems, calcLevels, calcPracticeIds, currentCalcLevel, evalCalcLevel, isContestLevel, nextSuggestion,
  type CalcLevelDef,
} from '../calc/ladders';
import { calcContestOutcome, calcContestSessions, calcPracticeOutcome, contestScore } from '../calc/calcOutcome';
import { newSeed, seeded } from '../calc/rng';
import { Btn, Empty, Field, Panel } from '../components/ui';
import CourseBar from '../components/CourseBar';
import { useCoachReview } from '../components/CoachReview';
import NumberPad from '../components/NumberPad';
import { courseStep } from '../coach';
import {
  Countdown, Dymo, Folder, Held, Hud, IndexCard, Key, KeyLink, QuestionCard, ResultSheet,
  pressVisual, useFocusMode, useFullscreen, useJudge,
} from '../components/lp';

/*
 * 계산 종목 공통 실행기(달력 제외) — 사다리 칸 연습과 규정대로 치르는 모의 대회.
 * 문항 모양(calc/problem)과 종목별 문항 만들기(calc/makers)만 보므로 새 종목은 그 두 곳에 더한다.
 * 연습: 맞으면 곧바로 다음 문제, 틀리면 정답·풀이를 붙잡아 보여 준다.
 * 모의 대회: 전체 화면 → 3-2-1 → 판정 연출·붙잡힘 없이 규정 문항을 끝까지(제한시간이 있으면 그때까지) → 결과.
 * 답은 입력칸 없이 상태로 가진다 — 휴대폰에서 기기 키보드가 뜨지 않고 숫자 자판만 쓴다.
 */

type Phase = 'setup' | 'countdown' | 'asking' | 'feedback' | 'done';

/** 한 판 동안 바뀌지 않는 설정 — 시작할 때 굳힌다 */
interface RunCfg {
  level: CalcLevelDef;
  contest: boolean;
  /** 문항 설정(maker.params) */
  params: RuleValues;
  /** 규정 사본 */
  rules: RuleValues;
  items: number;
  /** 0 = 제한 없음(연습은 언제나 0) */
  limitSec: number;
  penalty: number;
  /** 문제 글자 크기 — 한 판 동안 하나로 고정 */
  size: 'l' | 'm';
}

interface Result {
  q: Problem;
  /** 친 답(정규화한 글자). '' = 모름 */
  given: string;
  isCorrect: boolean;
  rtMs: number;
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const limitText = (sec: number) => (sec % 60 ? `${sec}초` : `${sec / 60}분`);

export default function CalcRun() {
  const { id = '' } = useParams();
  const ev = CALC_EVENTS.find((e) => e.id === id);
  const maker = CALC_MAKERS[id];
  const levels = calcLevels(id);
  if (!ev || ev.status !== 'ready' || !maker || !levels.length) {
    return (
      <Empty>
        아직 열리지 않은 종목입니다.{' '}
        <Link to="/calc" className="text-red underline underline-offset-2">목록으로</Link>
      </Empty>
    );
  }
  return <Runner ev={ev} maker={maker} levels={levels} />;
}

function Runner({ ev, maker, levels }: { ev: CalcEvent; maker: CalcMaker; levels: CalcLevelDef[] }) {
  const [params] = useSearchParams();
  const rules = useLiveQuery(() => getRules(ev), [ev.id]);
  const fs = useFullscreen();

  /* 종목 화면·코스에서 ?level=n 또는 ?mode=contest 로 넘어오면 그 칸으로. 없으면 지금 칸 */
  const [picked, setPicked] = useState<number | null>(() => {
    const n = params.get('mode') === 'contest' ? levels.find(isContestLevel)?.n : Number(params.get('level'));
    return levels.some((l) => l.n === n) ? (n as number) : null;
  });
  /* 코스로 열면 주소의 문항 수(?n). 주소가 바뀌면 화면을 새로 연다(App 의 key) */
  const [count, setCount] = useState(() => {
    const n = Math.round(Number(params.get('n')));
    return n > 0 ? Math.min(200, Math.max(5, n)) : 20;
  });
  const course = courseStep(params);
  const [phase, setPhase] = useState<Phase>('setup');
  const [cfg, setCfg] = useState<RunCfg | null>(null);
  const [queue, setQueue] = useState<Problem[]>([]);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [last, setLast] = useState<Result | null>(null);
  const [streak, setStreak] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  /** 연습에서 칸을 통과했을 때 권할 다음 칸(자동으로 올리지 않는다) */
  const [suggest, setSuggest] = useState<CalcLevelDef | null>(null);
  /** 시계 — 판을 시작한 때와 지금(performance.now 기준) */
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(0);

  /* 사다리 — 설정 화면에서만 읽는다(측정 중 문항이 쌓일 때마다 다시 계산하지 않게) */
  const ladder = useLiveQuery(async () => {
    if (phase !== 'setup') return undefined;
    const [log, saved] = await Promise.all([loadCalcLog(ev.id), db.ladderState.get(ev.id)]);
    const statuses = calcLadderStatus(ev.id, log);
    const best = rules ? Math.max(0, ...calcContestSessions(log, ev, rules).map((s) => s.score)) : 0;
    return { statuses, current: currentCalcLevel(ev.id, statuses, saved?.currentLevel), best };
  }, [phase, rules, ev]);

  const level = levels.find((l) => l.n === picked) ?? ladder?.current ?? levels[0];

  /** 친 답 — 빠른 입력이 앞 렌더의 값을 읽지 않게 ref 에도 둔다 */
  const typedRef = useRef('');
  const t0 = useRef(0);
  const shownAt = useRef(0);
  /** 이 판 세션의 startedAt — 모의 대회 걸린 시간을 지난 판과 같은 잣대(endedAt − startedAt)로 */
  const startWall = useRef(0);
  /** 끝내기가 겹치지 않게 */
  const finishing = useRef(false);
  /** 판정을 저장하는 사이 들어온 두 번째 입력이 같은 문항을 또 기록하지 않게 */
  const answering = useRef(false);
  /** 판 번호 — 시작 저장을 기다리는 사이 취소되면(또는 새 판이 열리면) 그 시작은 화면을 바꾸지 않는다 */
  const runNo = useRef(0);
  const padRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);

  /* 판정 연출은 연출 층과 머리띠에서만. 문제 카드는 조각이 넘지 않을 선을 재는 데만 넘긴다(측정 구간) */
  const judge = useJudge();
  const { show: showJudge, shake, reset: resetJudge } = judge;
  /* 스승님 복기 — 성적표가 나온 판에서만 */
  const coach = useCoachReview('calc', phase === 'done' && outcome ? sessionId : '');

  const setAnswer = useCallback((v: string) => {
    typedRef.current = v;
    setTyped(v);
  }, []);

  /** 새 판. 문제는 세션 시드로 만든다 — 같은 시드면 같은 문제(기획서 §5.7) */
  const start = async () => {
    if (!rules) return;
    const contest = isContestLevel(level);
    const p = maker.params(rules, level);
    const items = contest ? Math.max(1, Number(rules.items) || 10) : Math.min(200, Math.max(5, Math.round(count) || 20));
    const limitSec = contest ? Math.max(0, Number(rules.timeLimitSec) || 0) : 0;
    const seed = newSeed();
    const r = seeded(seed);
    const qs = Array.from({ length: items }, () => maker.make(r, p));
    const c: RunCfg = {
      level, contest, params: p, rules: { ...rules }, items, limitSec,
      penalty: Number(rules.penaltyPerWrong) || 0, size: promptSize(qs),
    };
    const id = uid();
    const run = ++runNo.current;
    const startedAt = Date.now();
    await db.calcSessions.add({
      id, disciplineId: ev.id, mode: contest ? 'contest' : 'practice', rules: c.rules,
      params: contest ? { level: level.n, items, limitSec, ...p } : { level: level.n, items, ...p },
      seed, startedAt, correct: 0, wrong: 0, score: 0,
    });
    /* 3-2-1 이 끝나 저장하는 사이 Esc·전체 화면 해제로 취소했으면 취소가 이긴다(그 판은 endedAt 없이 남는다) */
    if (run !== runNo.current) return;
    startWall.current = startedAt;
    finishing.current = false;
    answering.current = false;
    resetJudge();
    setCfg(c);
    setSessionId(id);
    setQueue(qs);
    setIdx(0);
    setAnswer('');
    setResults([]);
    setLast(null);
    setStreak(0);
    setOutcome(null);
    setSuggest(null);
    const t = performance.now();
    setStartAt(t);
    setNow(t);
    setPicked(level.n);
    setPhase('asking');
  };

  /**
   * 시작 · 한 판 더. 모의 대회는 전체 화면을 켠 뒤 3-2-1 을 거친다.
   * 전체 화면은 사용자 동작(누름·키) 안에서만 켜지므로 누름 처리기에서 바로 부른다.
   */
  const begin = () => {
    if (!isContestLevel(level)) { start(); return; }
    fs.enter();
    finishing.current = false;
    setPicked(level.n);
    setPhase('countdown');
  };

  const finish = useCallback(async (final: Result[]) => {
    if (!cfg || finishing.current) return;
    finishing.current = true;
    const correct = final.filter((r) => r.isCorrect).length;
    const wrong = final.length - correct;
    const score = cfg.contest ? contestScore(correct, wrong, cfg.penalty) : correct;
    const endedAt = Date.now();
    await db.calcSessions.update(sessionId, { endedAt, correct, wrong, score });
    if (cfg.contest || final.length) {
      const log = await loadCalcLog(ev.id);
      if (cfg.contest) {
        /* 같은 규정으로 끝까지 치른 지난 모의 대회만. 걸린 시간은 이 세션에 저장한 endedAt − startedAt */
        const past = calcContestSessions(log, ev, cfg.rules).filter((s) => s.id !== sessionId);
        setOutcome(calcContestOutcome({
          eventId: ev.id,
          run: { items: cfg.items, correct, wrong, score, totalMs: endedAt - startWall.current, limitSec: cfg.limitSec },
          past,
        }));
      } else {
        /* 평균 시간은 통합 기록(sessions.ts)과 같은 방식 — 모름(0)을 뺀 평균 */
        const rts = final.map((r) => r.rtMs).filter((x) => x > 0);
        const meanRtMs = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
        const ids = calcPracticeIds(log, cfg.level.n);
        setOutcome(calcPracticeOutcome({
          run: {
            items: final.length, correct, meanRtMs,
            maxStreak: streaks(final.map((r) => r.isCorrect)).best, totalMs: performance.now() - startAt,
          },
          /* 목표 막대는 이번 판까지 넣은 이 칸의 최근 기록 */
          status: evalCalcLevel(cfg.level, calcLevelItems(log, cfg.level.n)),
          past: calcSummaries(log).filter((s) => ids.has(s.id) && s.id !== sessionId),
        }));
        setSuggest(nextSuggestion(ev.id, calcLadderStatus(ev.id, log), cfg.level.n));
      }
    }
    setResults(final);
    setPhase('done');
  }, [cfg, ev, sessionId, startAt]);

  /** 답 내기. giveUp = 모름(연습만) */
  const submit = useCallback(async (giveUp: boolean) => {
    const cur = queue[idx];
    const at = performance.now();
    /* 끝내는 중이거나 앞 판정을 저장하는 사이 들어온 입력은 버린다 — 같은 문항이 두 번 기록되지 않게 */
    if (!cur || !cfg || phase !== 'asking' || finishing.current || answering.current) return;
    const given = giveUp ? '' : normalizeAnswer(typedRef.current);
    /* 빈 답은 내지 않는다 — 모름은 Tab */
    if (!giveUp && !given) return;
    if (cfg.limitSec > 0 && at >= startAt + cfg.limitSec * 1000) return;
    answering.current = true;

    const ok = !giveUp && given === cur.expected;
    /* 모름은 반응시간 0 — 포기까지 걸린 시간은 셈한 시간이 아니다 */
    const rtMs = giveUp ? 0 : Math.round(at - t0.current);
    const r: Result = { q: cur, given, isCorrect: ok, rtMs };
    const nextStreak = ok ? streak + 1 : 0;
    /* 판정 연출·소리는 입력 즉시 — 기록 저장을 기다리지 않는다. 모의 대회는 판정 연출이 없다 */
    if (!cfg.contest) showJudge(ok ? 'good' : giveUp ? 'skip' : 'bad', nextStreak, cardRef.current);
    try {
      await db.calcItems.add({
        id: uid(), sessionId, index: idx, kind: cur.kind, prompt: cur.prompt, expected: cur.expected,
        answered: given, isCorrect: ok, rtMs, shownAt: shownAt.current,
      });
    } catch (e) {
      answering.current = false;
      throw e;
    }
    const next = [...results, r];
    setResults(next);
    setStreak(nextStreak);
    if (cfg.contest || ok) {
      /* 맞으면(모의 대회는 언제나) 멈추지 않는다 */
      if (idx + 1 >= queue.length) await finish(next);
      else { setIdx(idx + 1); setAnswer(''); }
    } else {
      setLast(r);
      setPhase('feedback');
      /* 붙잡힌 뒤(측정이 끝난 뒤)에만 카드를 한 번 흔든다 */
      if (!giveUp) shake(cardRef.current);
    }
  }, [cfg, finish, idx, phase, queue, results, sessionId, setAnswer, shake, showJudge, startAt, streak]);

  /** 숫자·소수점 한 글자(appendAnswer 규칙) */
  const typeChar = useCallback((ch: string) => {
    if (phase !== 'asking' || answering.current) return;
    setAnswer(appendAnswer(typedRef.current, ch));
  }, [phase, setAnswer]);

  /** 한 글자 지우기 전용 — 빈 답에서 앞 문제로 넘기지 않는다 */
  const backspace = useCallback(() => {
    if (phase !== 'asking' || answering.current) return;
    setAnswer(typedRef.current.slice(0, -1));
  }, [phase, setAnswer]);

  const continueAfterWrong = useCallback(() => {
    if (idx + 1 >= queue.length) finish(results);
    else { setIdx(idx + 1); setAnswer(''); setPhase('asking'); }
  }, [finish, idx, queue.length, results, setAnswer]);

  /** 연습 중단 — 여기까지 푼 것으로 결과. 답을 저장하는 중이면 받지 않는다(그 답이 성적표에서 빠지지 않게) */
  const stop = useCallback(() => {
    if (!answering.current) finish(results);
  }, [finish, results]);

  /** 모의 대회 취소 — 설정으로. 끝까지 치르지 않은 판은 endedAt 이 없어 신기록 비교에 들어가지 않는다 */
  const cancel = useCallback(() => {
    if (finishing.current) return;
    finishing.current = true;
    runNo.current++;
    setPhase('setup');
  }, []);

  /* 판정이 화면에 그려진 뒤(다음 문항·붙잡힘·결과로 바뀐 뒤)에야 다음 입력을 받는다 */
  useEffect(() => { answering.current = false; }, [idx, phase, results]);

  /* 반응시간은 문제가 화면에 뜬 때부터 */
  useEffect(() => {
    if (phase !== 'asking') return;
    t0.current = performance.now();
    shownAt.current = Date.now();
  }, [phase, idx]);

  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  /* 제한시간이 있는 모의 대회: 시간이 되면 끝. 못 푼 문항은 무응답. 저장 중인 답이 있으면 그것이 반영된 뒤에 */
  useEffect(() => {
    if (cfg?.contest && cfg.limitSec > 0 && phase === 'asking' && now >= startAt + cfg.limitSec * 1000 && !answering.current) {
      finish(results);
    }
  }, [cfg, finish, now, phase, results, startAt]);

  /* 모의 대회를 마치거나(결과) 그만두면(설정) 전체 화면을 푼다 */
  useEffect(() => {
    if (phase === 'setup' || phase === 'done') fs.exit();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 측정 동안에는 앱 머리말과 아래 탭을 내린다 — 모의 대회는 방해 요소 없는 화면, 연습은 숫자 자판이 커서
     짧은 휴대폰(보이는 높이 약 670px)에서 '제출'이 아래 탭에 가리기 때문 */
  useFocusMode(phase === 'countdown' || phase === 'asking' || phase === 'feedback');

  const cur = queue[idx];
  const contestRun = phase === 'countdown' || !!cfg?.contest;

  /*
   * 단축키 — 숫자·'.' 로 치고, Backspace = 한 글자 지우기(앞 문제로 넘기지 않는다), Enter = 제출,
   * Tab = 모름(연습만), Esc = 중단(연습) · 취소(모의 대회). 붙잡힌 동안 Enter = 계속.
   * 결과 화면의 키(공개 중 아무 키 = 건너뛰기, 끝난 뒤 Enter = 한 판 더)는 ResultSheet 가 맡는다.
   */
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'asking' && phase !== 'feedback') return;
    const onKey = (e: KeyboardEvent) => {
      // 성적표에서 Enter(한 판 더)로 새 판이 열리면 같은 키가 여기까지 온다 — 이미 처리된 키는 받지 않는다
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); if (contestRun) cancel(); else stop(); return; }
      if (phase === 'feedback') {
        /* 제출한 Enter 를 누르고 있어도 붙잡힌 풀이를 건너뛰지 않게 반복 입력은 받지 않는다 */
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); continueAfterWrong(); }
        return;
      }
      if (phase !== 'asking' || !cfg) return;
      /* 마우스로 누른 자판에 남은 포커스를 Enter·Space 가 다시 누르지 않게 기본 동작을 막는다 */
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat && normalizeAnswer(typedRef.current)) { pressVisual(padRefs.current.submit); submit(false); }
        return;
      }
      if (e.key === ' ') { e.preventDefault(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (!cfg.contest && !e.repeat) { pressVisual(padRefs.current.skip); submit(true); }
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (typedRef.current) pressVisual(padRefs.current.back);
        backspace();
        return;
      }
      const ch = /^[0-9]$/.test(e.key) ? e.key : e.key === '.' || e.code === 'NumpadDecimal' ? '.' : null;
      if (!ch || e.repeat) return;
      e.preventDefault();
      pressVisual(padRefs.current[ch]);
      typeChar(ch);
    };
    /* 전체 화면에서는 브라우저가 첫 Esc 를 '전체 화면 나가기'로 가져가 keydown 이 오지 않는다 → 풀리면 취소로 본다 */
    const onFs = () => { if (contestRun && !document.fullscreenElement) cancel(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [backspace, cancel, cfg, continueAfterWrong, contestRun, phase, stop, submit, typeChar]);

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    const contest = isContestLevel(level);
    const p = rules ? maker.params(rules, level) : null;
    const limit = Number(rules?.timeLimitSec) || 0;
    const contestBrief = `${Number(rules?.items) || 10}문제 · ${limit ? `제한 ${limitText(limit)}` : '시간 제한 없음'}`;
    /** 칸을 고르면 위의 '이번 판' 이 보이게 올린다 */
    const pick = (n: number) => {
      setPicked(n);
      folderRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    };
    return (
      <div className="flex flex-col gap-4">
        <CourseBar step={course} />
        <header>
          <div className="flex items-center justify-between gap-2">
            <Dymo tone="blue" small>계산 종목</Dymo>
            <KeyLink to={`/calc/${ev.id}`} tone="cream" size="sm">종목 화면</KeyLink>
          </div>
          <h1 className="mt-4 font-sign text-[40px] leading-[1.05] text-ink">{ev.name}</h1>
          <p className="mt-1.5 font-typek text-xs text-ink-2">답은 숫자 자판이나 키보드로 치고 Enter 로 냅니다.</p>
        </header>

        <div ref={folderRef} className="scroll-mt-16">
          <Folder tab="이번 판" clip>
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-xl leading-tight text-ink">{level.n}. {level.name}</h2>
                <p className="mt-1 text-sm text-ink-2">{level.what}{p && ` · ${maker.ask(p)}`}</p>
              </div>
              {!contest && (
                <Field label="문항 수">
                  <input className="tnum w-28" type="number" min={5} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </Field>
              )}
              {contest && rules && <ContestRules ev={ev} rules={rules} />}
              <Key tone="red" size="big" disabled={!rules} onClick={begin}>시작</Key>
            </div>
          </Folder>
        </div>

        <section className="flex flex-col gap-2.5">
          <Dymo small className="self-start">사다리</Dymo>
          {levels.map((l, i) => {
            const s = ladder?.statuses[i];
            const meta = [s?.passed && '통과', ladder?.current.n === l.n && '지금 칸'].filter(Boolean).join(' · ');
            return (
              <IndexCard
                key={l.id}
                title={`${l.n}. ${l.name}`}
                meta={meta || undefined}
                body={l.pass ? l.what : `${contestBrief} · ${ladder?.best ? `최고 ${ladder.best}점` : '아직 기록 없음'}`}
                onClick={() => pick(l.n)}
                className={l.n === level.n ? 'outline-2 outline-offset-2 outline-ink' : undefined}
              >
                {s && s.bars.length > 0 && <Bars bars={s.bars} />}
              </IndexCard>
            );
          })}
        </section>
      </div>
    );
  }

  /* ───────── 모의 대회 3-2-1 ───────── */
  if (phase === 'countdown') return <Countdown onDone={start} />;

  /* ───────── 결과 ───────── */
  if (phase === 'done') {
    const actions = (
      <div className="flex gap-2">
        <Key tone="cream" className="flex-1" onClick={() => setPhase('setup')}>설정으로</Key>
        <KeyLink to={`/calc/${ev.id}`} tone="cream" className="flex-1">종목 화면</KeyLink>
      </div>
    );
    if (!outcome) {
      return (
        <Panel title={ev.name}>
          <Empty>기록된 문항이 없습니다.</Empty>
          <div className="flex flex-col gap-4">
            <Key tone="red" size="big" onClick={begin}>한 번 더</Key>
            {actions}
          </div>
        </Panel>
      );
    }
    const wrongs = results.filter((r) => !r.isCorrect);
    const unanswered = cfg?.contest ? cfg.items - results.length : 0;
    /* 신기록 무대가 화면 뒤를 덮으므로 함께 볼 상세는 children 으로 넘긴다 */
    return (
      <ResultSheet
        outcome={outcome}
        onAgain={begin}
        sage={coach.sage}
        actions={
          <>
            <CourseBar
              step={course}
              sessionId={sessionId}
              played={cfg ? { kind: 'calc', eventId: ev.id, level: cfg.level.n } : undefined}
            />
            {suggest && (
              <div className="flex items-center gap-2 rounded-[4px] bg-card px-3 py-2">
                <p className="m-0 flex-1 font-typek text-[12.5px] text-ink">
                  다음 칸 권함: <b>{suggest.n}. {suggest.name}</b>
                </p>
                {/* 주소 이동이 아니라 화면 안에서 — 권한 칸이 지금 주소와 같으면 링크로는 화면이 바뀌지 않는다 */}
                <Key tone="cream" size="sm" onClick={() => { setPicked(suggest.n); setPhase('setup'); }}>그 칸으로</Key>
              </div>
            )}
            {actions}
            {coach.action}
          </>
        }
      >
        {unanswered > 0 && (
          <p className="m-0 text-center font-typek text-[12.5px] text-ink-2">시간이 다 되어 {unanswered}문제는 풀지 못했습니다.</p>
        )}
        {wrongs.length > 0 && (
          <Panel title="틀린 문제">
            <ul className="flex flex-col">
              {wrongs.map((r, i) => <WrongRow key={i} r={r} />)}
            </ul>
          </Panel>
        )}
      </ResultSheet>
    );
  }

  /* ───────── 측정 ───────── */
  if (!cur || !cfg) return null;
  const held = phase === 'feedback' ? last : null;
  const showing = held ? held.q : cur;
  const elapsed = Math.max(0, Math.floor((now - startAt) / 1000));
  const left = startAt + cfg.limitSec * 1000 - now;
  /* 여러 줄 문제(세로셈)는 오른쪽 끝을 맞춘다 */
  const prompt = showing.lines
    ? <span className="inline-flex flex-col items-end">{showing.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
    : showing.prompt;
  const help = `${maker.ask(cfg.params)} · Enter 제출${cfg.contest ? '' : ' · Tab 모름'}`;

  return (
    <div className="flex flex-col gap-3">
      {!cfg.contest && judge.layer}

      <div className="flex items-center gap-3">
        {!cfg.contest && <span className="tnum text-[13px] text-ink-2">{mmss(elapsed)}</span>}
        <Btn size="sm" className="ml-auto" onClick={cfg.contest ? cancel : stop}>{cfg.contest ? '취소 (Esc)' : '중단 (Esc)'}</Btn>
      </div>

      {cfg.contest ? (
        <Hud
          left={<>{ev.name} · 모의 대회 · <b>{idx + 1}</b>/{queue.length}</>}
          right={cfg.limitSec > 0
            ? <Clock sec={Math.max(0, Math.ceil(left / 1000))} warn={left <= 10_000} />
            : <Clock sec={elapsed} warn={false} />}
        />
      ) : (
        <Hud left={<>{ev.name} · {cfg.level.name} · <b>{idx + 1}</b>/{queue.length}</>} streak={streak} judge={judge} />
      )}

      <QuestionCard ref={cardRef} size={cfg.size} prompt={prompt} help={help} />

      <AnswerBox text={held ? held.given : typed} wrong={!!held} caret={phase === 'asking'} />

      {phase === 'asking' && (
        <NumberPad
          refs={padRefs}
          onType={typeChar}
          onBackspace={backspace}
          onSubmit={() => submit(false)}
          onSkip={cfg.contest ? undefined : () => submit(true)}
        />
      )}

      {held && (
        <>
          <Held>
            <div>정답 <b>{held.q.expected}</b></div>
            <div className="mt-0.5">
              {held.given
                ? <>입력한 답 <span className="font-type font-bold text-blue">{held.given}</span></>
                : '모름으로 넘겼습니다'}
            </div>
            <Explain lines={held.q.explain} className="mt-1 text-[12px]" />
          </Held>
          <Key size="big" sub="Enter" onClick={continueAfterWrong}>계속</Key>
        </>
      )}
    </div>
  );
}

/** 모의 대회 규정 요약 — 등록부의 규정 칸 그대로 */
function ContestRules({ ev, rules }: { ev: CalcEvent; rules: RuleValues }) {
  const limit = Number(rules.timeLimitSec) || 0;
  return (
    <div className="rounded-[4px] bg-card px-3 py-2.5 font-typek text-xs leading-relaxed text-ink-2">
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1">
        {ev.rules.map((f) => (
          <div key={f.key} className="flex items-baseline justify-between gap-2">
            <dt>{f.label}</dt>
            <dd className="tnum m-0 font-bold text-ink">{ruleText(f, rules[f.key])}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-1.5">
        {limit ? '제한시간이 되면 그때까지 푼 문제로 끝납니다.' : '시간 제한 없음, 걸린 시간만 잽니다.'} 시작하면 전체 화면으로 바뀝니다.
      </p>
    </div>
  );
}

function ruleText(f: RuleField, v: number | string | undefined): string {
  if (f.kind === 'choice') return f.options.find((o) => o.value === v)?.label ?? '—';
  if (f.key === 'timeLimitSec' && !Number(v)) return '없음';
  return `${v ?? '—'}${f.unit ?? ''}`;
}

/** 답 칸 — 높이 고정, 친 글자와 멈춘 커서만. 붙잡힌 동안에는 방금 낸 답을 파란 글씨로 둔다 */
function AnswerBox({ text, wrong, caret }: { text: string; wrong: boolean; caret: boolean }) {
  return (
    <div className="flex h-14 items-center justify-center overflow-hidden whitespace-nowrap border-b-2 border-ink-2 bg-input px-3 font-type text-[28px] font-bold leading-none">
      <span className={wrong ? 'text-blue' : 'text-ink'}>{text}</span>
      {caret && <span aria-hidden className="ml-0.5 inline-block h-8 w-[3px] bg-ink" />}
    </div>
  );
}

function Explain({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 leading-snug break-words ${className ?? ''}`}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}

/** 머리띠 오른쪽 시계. 제한시간이 있으면 남은 시간이고 마지막 10초만 빨강 — 측정 화면의 강조는 이 한 곳이다 */
function Clock({ sec, warn }: { sec: number; warn: boolean }) {
  return <span className={`tnum text-[26px] font-bold leading-none ${warn ? 'text-red' : 'text-ink'}`}>{mmss(sec)}</span>;
}

/** 사다리 칸의 세 조건 — 성적표 목표 막대와 같은 모양(lp-bar), 빨간 세로선이 기준 */
function Bars({ bars }: { bars: OutcomeGoal[] }) {
  return (
    <div className="lp-bars">
      {bars.map((b) => (
        <div key={b.label} className="lp-bar" style={{ gridTemplateColumns: '64px 1fr auto' }}>
          <span>{b.label}</span>
          <span className="lp-bar-track">
            <span className="lp-bar-fill" style={{ '--w': b.ratio } as CSSProperties} />
            <span className="lp-bar-goal" />
          </span>
          <span className="lp-bar-num">{b.text}</span>
        </div>
      ))}
    </div>
  );
}

/** 틀린 문제 한 줄: 문제 → 정답 · 친 답, 아래 풀이 */
function WrongRow({ r }: { r: Result }) {
  return (
    <li className="border-b border-card-edge py-1.5 font-typek text-[13px] last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tnum text-[15px] font-bold text-ink">{r.q.prompt}</span>
        <span className="text-ink-2">→</span>
        <span className="tnum text-ink">{r.q.expected}</span>
        <span className="tnum ml-auto text-blue">{r.given ? `입력 ${r.given}` : '모름'}</span>
      </div>
      <Explain lines={r.q.explain} className="mt-0.5 text-[11px] text-ink-2" />
    </li>
  );
}
