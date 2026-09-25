import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db, type CalcStep, type RuleValues } from '../db/db';
import { calcSummaries, loadCalcLog } from '../db/calcLog';
import { CALC_EVENTS } from '../data/events';
import { getRules } from '../lib/rules';
import { uid } from '../lib/random';
import { streaks } from '../lib/streak';
import type { OutcomeGoal, RunOutcome } from '../lib/outcome';
import { reduced } from '../design/settings';
import { isTyping } from '../App';
import { keyToWeekday, weekdayKey, weekdayOrder, WEEKDAY_KO, WEEKDAY_LONG, type WeekBase } from '../calc/calendar';
import {
  contestScore, explain, makeItem, stepAverages, type CalDrill, type CalItem, type CalParams, type CalStepSpec,
} from '../calc/calendarDrill';
import {
  CAL_LEVELS, CALENDAR_LADDER, contestSessions, currentLevel, evalLevel, ladderStatus, levelItems, practiceIds, yearsFor,
  type CalLevel, type ContestKey,
} from '../calc/calendarLadder';
import { contestOutcome, practiceOutcome } from '../calc/calendarOutcome';
import { newSeed, seeded, type Rng } from '../calc/rng';
import { Btn, Empty, Field, Panel, Stat } from '../components/ui';
import {
  Countdown, Dymo, Folder, Held, Hud, IndexCard, Key, KeyLink, QuestionCard, ResultSheet,
  pressVisual, useFocusMode, useFullscreen, useJudge,
} from '../components/lp';

/*
 * 달력 실행기 — 사다리 칸 연습(연도 코드 · 월·세기 코드 · 전체 계산)과 1분 모의 대회.
 * 연습: 틀리면 풀이를 붙잡아 보여 주고, 맞으면 곧바로 다음 문제. 전체 계산은 단계 입력(연도 코드 → 월 코드 → 요일)을 켤 수 있다.
 * 모의 대회: 시작 누름에서 전체 화면 → 3-2-1 → 제한시간 동안 판정 연출·계수기·붙잡힘 없이 계속 → 결과.
 * 문항은 누를 때마다 calcItems 에 한 줄(원시 데이터), 문제는 세션 시드로 만든다.
 */

const EV = CALC_EVENTS.find((e) => e.id === 'calendar')!;
/** 규정 제한시간이 비어 있을 때(0) 모의 대회 시간 */
const DEFAULT_LIMIT = 60;

/** 지금 규정의 모의 대회 조건 — 설정 화면의 '최고' 는 이 조건으로 치른 판에서만 */
const contestKey = (rules: RuleValues): ContestKey => {
  const [yearFrom, yearTo] = yearsFor(CAL_LEVELS.find((l) => l.drill === 'contest')!, rules);
  return { limitSec: Number(rules.timeLimitSec) || DEFAULT_LIMIT, penalty: Number(rules.penaltyPerWrong) || 0, yearFrom, yearTo };
};

type Phase = 'setup' | 'countdown' | 'asking' | 'feedback' | 'done';

/** 문제 글자 크기 — 드릴마다 하나로 고정. 날짜(10자)는 m 이어야 휴대폰 폭에 들어간다 */
const SIZE: Record<CalDrill, 'xl' | 'l' | 'm'> = { year: 'xl', code: 'l', full: 'm' };

/* 답 자판 일곱이 휴대폰 기둥 안쪽(약 347px) 한 줄에: 40 × 7 + 8 × 6 = 328px, 자판 둘레 테두리 4px 까지 들어간다 */
const CELL: CSSProperties = { width: 40, height: 52, fontSize: 18 };
const CODES = [0, 1, 2, 3, 4, 5, 6];

/** 한 판 동안 바뀌지 않는 설정 — 시작할 때 굳힌다 */
interface RunCfg {
  level: CalLevel;
  drill: CalDrill;
  contest: boolean;
  params: CalParams;
  limitSec: number;
  penalty: number;
  base: WeekBase;
}

interface Result {
  item: CalItem;
  /** 친 답 — 요일은 0(일)~6(토), 코드는 그 숫자. '' = 모름 */
  given: string;
  isCorrect: boolean;
  rtMs: number;
  steps?: CalcStep[];
  /** 단계 입력에서 요일 전에 틀려 멈춘 단계 */
  wrongStep?: string;
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** 지금 받는 답이 요일인가(아니면 0~6 코드) */
const asksWeekday = (item: CalItem, step: number) => item.kind === 'full' && (!item.steps || step === item.steps.length - 1);

/** 답을 글자로: 요일이면 '수요일', 코드면 숫자 */
const valText = (weekday: boolean, v: string | number) => (weekday ? WEEKDAY_LONG[Number(v)] : String(v));

export default function CalendarRun() {
  const [params] = useSearchParams();
  const rules = useLiveQuery(() => getRules(EV), []);
  const fs = useFullscreen();

  /* 종목 화면에서 ?level=n 또는 ?mode=contest 로 넘어오면 그 칸으로. 없으면 지금 칸 */
  const [picked, setPicked] = useState<number | null>(() => {
    const n = params.get('mode') === 'contest' ? 5 : Number(params.get('level'));
    return CAL_LEVELS.some((l) => l.n === n) ? n : null;
  });
  const [count, setCount] = useState(20);
  const [stepsOn, setStepsOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [cfg, setCfg] = useState<RunCfg | null>(null);
  const [queue, setQueue] = useState<CalItem[]>([]);
  const [idx, setIdx] = useState(0);
  /** 단계 입력에서 지금 단계(0 연도 코드 · 1 월 코드 · 2 요일) */
  const [step, setStep] = useState(0);
  const [stepLog, setStepLog] = useState<CalcStep[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [last, setLast] = useState<Result | null>(null);
  const [streak, setStreak] = useState(0);
  const [sessionId, setSessionId] = useState('');
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  /** 시계 — 판을 시작한 때와 지금(performance.now 기준). 모의 대회는 startAt + 제한시간에 끝난다 */
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(0);

  /* 사다리 — 설정 화면에서만 읽는다(측정 중 문항이 쌓일 때마다 다시 계산하지 않게) */
  const ladder = useLiveQuery(async () => {
    if (phase !== 'setup') return undefined;
    const [log, saved] = await Promise.all([loadCalcLog(EV.id), db.ladderState.get(CALENDAR_LADDER)]);
    const statuses = ladderStatus(log);
    const best = rules ? Math.max(0, ...contestSessions(log, contestKey(rules)).map((s) => s.score)) : 0;
    return { statuses, current: currentLevel(statuses, saved?.currentLevel), best };
  }, [phase, rules]);

  const level = CAL_LEVELS.find((l) => l.n === picked) ?? ladder?.current ?? CAL_LEVELS[0];
  const base: WeekBase = rules?.weekBase === 'mon1' ? 'mon1' : 'sun0';
  const limitSet = Number(rules?.timeLimitSec) || 0;

  const t0 = useRef(0);
  const stepT0 = useRef(0);
  const shownAt = useRef(0);
  const rng = useRef<Rng>(Math.random);
  /** 끝내기가 겹치지 않게 */
  const finishing = useRef(false);
  /** 판정을 저장하는 사이 들어온 두 번째 입력이 같은 문항을 또 기록하지 않게 */
  const answering = useRef(false);
  /** 판 번호 — 시작 저장을 기다리는 사이 취소되면(또는 새 판이 열리면) 그 시작은 화면을 바꾸지 않는다 */
  const runNo = useRef(0);
  const keyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);

  /* 판정 연출은 연출 층과 머리띠에서만. 문제 카드는 조각이 넘지 않을 선을 재는 데만 넘긴다(측정 구간) */
  const judge = useJudge();
  const { show: showJudge, shake, reset: resetJudge } = judge;

  /** 새 판. 문제는 세션 시드로 만든다 — 같은 시드면 같은 문제(기획서 §5.7) */
  const start = async () => {
    if (!rules) return;
    const [yearFrom, yearTo] = yearsFor(level, rules);
    const contest = level.drill === 'contest';
    const c: RunCfg = {
      level, contest,
      drill: contest ? 'full' : (level.drill as CalDrill),
      params: { yearFrom, yearTo, steps: level.drill === 'full' && stepsOn },
      limitSec: limitSet || DEFAULT_LIMIT,
      penalty: Number(rules.penaltyPerWrong) || 0,
      base,
    };
    const seed = newSeed();
    const r = seeded(seed);
    /* 모의 대회는 시간이 다 될 때까지 한 문제씩 이어 만든다 */
    const n = contest ? 1 : Math.min(200, Math.max(5, Math.round(count) || 20));
    const qs = Array.from({ length: n }, () => makeItem(c.drill, c.params, r));
    const id = uid();
    const run = ++runNo.current;
    await db.calcSessions.add({
      id, disciplineId: EV.id, mode: contest ? 'contest' : 'practice', rules: { ...rules },
      params: {
        level: level.n, drill: c.drill, yearFrom, yearTo, steps: c.params.steps ? 1 : 0,
        /* 모의 대회는 문항 수가 정해져 있지 않다(0). 대신 실제로 쓴 제한시간을 남긴다(규정이 0 이면 60초) */
        items: contest ? 0 : n, ...(contest ? { limitSec: c.limitSec } : {}),
      },
      seed, startedAt: Date.now(), correct: 0, wrong: 0, score: 0,
    });
    /* 3-2-1 이 끝나 저장하는 사이 Esc·전체 화면 해제로 취소했으면 취소가 이긴다(그 판은 endedAt 없이 남는다) */
    if (run !== runNo.current) return;
    rng.current = r;
    finishing.current = false;
    answering.current = false;
    resetJudge();
    setCfg(c);
    setSessionId(id);
    setQueue(qs);
    setIdx(0);
    setStep(0);
    setStepLog([]);
    setResults([]);
    setLast(null);
    setStreak(0);
    setOutcome(null);
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
    if (level.drill !== 'contest') { start(); return; }
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
    await db.calcSessions.update(sessionId, { endedAt: Date.now(), correct, wrong, score });
    /* 평균 시간은 통합 기록(sessions.ts)과 같은 방식 — 모름(0)을 뺀 평균. 지난 판과 같은 잣대로 비교한다 */
    const rts = final.map((r) => r.rtMs).filter((x) => x > 0);
    const meanRtMs = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
    if (cfg.contest || final.length) {
      const log = await loadCalcLog(EV.id);
      if (cfg.contest) {
        /* 같은 조건(제한시간·오답 감점·연도 범위)으로 끝까지 치른 지난 모의 대회만, 최근 것이 앞 */
        const key = { limitSec: cfg.limitSec, penalty: cfg.penalty, yearFrom: cfg.params.yearFrom, yearTo: cfg.params.yearTo };
        const past = contestSessions(log, key)
          .filter((s) => s.id !== sessionId)
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((s) => s.score);
        setOutcome(contestOutcome({ run: { correct, wrong, score, perItemMs: meanRtMs, limitSec: cfg.limitSec }, past }));
      } else {
        /* 신기록·아까움은 같은 칸·같은 단계 입력 설정의 지난 판과만 */
        const ids = practiceIds(log, cfg.level.n, !!cfg.params.steps);
        setOutcome(practiceOutcome({
          run: {
            items: final.length, correct, meanRtMs,
            maxStreak: streaks(final.map((r) => r.isCorrect)).best, totalMs: performance.now() - startAt,
          },
          /* 목표 막대는 이번 판까지 넣은 이 칸의 최근 기록 */
          status: evalLevel(cfg.level, levelItems(log, cfg.level.n)),
          past: calcSummaries(log).filter((s) => ids.has(s.id) && s.id !== sessionId),
          steps: okStepAverages(final),
        }));
      }
    }
    setResults(final);
    setPhase('done');
  }, [cfg, sessionId, startAt]);

  /** 답 하나(단계 입력이면 단계 하나). value = null 은 모름 */
  const press = useCallback(async (value: number | null) => {
    const cur = queue[idx];
    const at = performance.now();
    /* 끝내는 중이거나 앞 판정을 저장하는 사이 들어온 입력은 버린다 — 같은 문항이 두 번 기록되지 않게(MappingDrill 과 같은 잠금) */
    if (!cur || !cfg || phase !== 'asking' || finishing.current || answering.current) return;
    /* 모의 대회는 시간이 다 된 뒤의 누름을 받지 않는다 */
    if (cfg.contest && at >= startAt + cfg.limitSec * 1000) return;
    answering.current = true;

    const giveUp = value == null;
    const spec = cur.steps?.[step];
    const ok = !giveUp && value === (spec ? spec.expected : cur.expected);
    const steps = spec && !giveUp
      ? [...stepLog, { name: spec.name, ms: Math.round(at - stepT0.current), given: String(value), ok }]
      : cur.steps && stepLog;
    /* 단계 입력: 맞으면 다음 단계로. 기록은 문항이 끝날 때 한 번 */
    if (spec && ok && step + 1 < cur.steps!.length) {
      setStepLog(steps!);
      setStep(step + 1);
      return;
    }

    /* 모름은 오답, 반응시간 0 — 포기까지 걸린 시간은 셈한 시간이 아니다 */
    const rtMs = giveUp ? 0 : Math.round(at - t0.current);
    const wrongStep = spec && !ok && !giveUp && !asksWeekday(cur, step) ? spec.name : undefined;
    const given = giveUp ? '' : String(value);
    const r: Result = { item: cur, given, isCorrect: ok, rtMs, steps, wrongStep };
    const nextStreak = ok ? streak + 1 : 0;
    /* 판정 연출·소리는 입력 즉시 — 기록 저장을 기다리지 않는다. 모의 대회는 판정 연출이 없다 */
    if (!cfg.contest) showJudge(ok ? 'good' : giveUp ? 'skip' : 'bad', nextStreak, cardRef.current);
    try {
      await db.calcItems.add({
        id: uid(), sessionId, index: idx, kind: cur.kind, prompt: cur.prompt, expected: String(cur.expected),
        /* 친 최종 답. 단계 입력이 요일 전에 틀려 멈췄으면 비우고, 그 단계에 친 값은 steps 에 남는다 */
        answered: wrongStep ? '' : given,
        isCorrect: ok, rtMs, ...(steps ? { steps } : {}), shownAt: shownAt.current,
      });
    } catch (e) {
      answering.current = false;
      throw e;
    }
    const next = [...results, r];
    setResults(next);
    setStreak(nextStreak);
    setStep(0);
    setStepLog([]);
    if (cfg.contest) {
      /* 누르면 곧바로 다음 문제. 같은 시드의 다음 문제를 이어 만든다 */
      setQueue([...queue, makeItem(cfg.drill, cfg.params, rng.current)]);
      setIdx(idx + 1);
    } else if (ok) {
      /* 맞으면 멈추지 않는다. 틀렸을 때만 풀이를 보여 주고 붙잡는다 */
      if (idx + 1 >= queue.length) await finish(next);
      else setIdx(idx + 1);
    } else {
      setLast(r);
      setPhase('feedback');
      /* 붙잡힌 뒤(측정이 끝난 뒤)에만 카드를 한 번 흔든다 */
      if (!giveUp) shake(cardRef.current);
    }
  }, [cfg, finish, idx, phase, queue, results, sessionId, shake, showJudge, startAt, step, stepLog, streak]);

  const continueAfterWrong = useCallback(() => {
    if (idx + 1 >= queue.length) finish(results);
    else { setIdx(idx + 1); setPhase('asking'); }
  }, [finish, idx, queue.length, results]);

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

  /* 판정이 화면에 그려진 뒤(다음 문항·단계·붙잡힘·결과로 바뀐 뒤)에야 다음 입력을 받는다 */
  useEffect(() => { answering.current = false; }, [idx, phase, results, step]);

  /* 반응시간은 문제(또는 단계)가 화면에 뜬 때부터 */
  useEffect(() => {
    if (phase !== 'asking') return;
    t0.current = performance.now();
    shownAt.current = Date.now();
  }, [phase, idx]);
  useEffect(() => {
    if (phase === 'asking') stepT0.current = performance.now();
  }, [phase, idx, step]);

  useEffect(() => {
    if (phase !== 'asking' && phase !== 'feedback') return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  /* 모의 대회: 시간이 다 되면 끝. 저장 중인 답이 있으면 그것이 반영된 뒤에 */
  useEffect(() => {
    if (cfg?.contest && phase === 'asking' && now >= startAt + cfg.limitSec * 1000 && !answering.current) finish(results);
  }, [cfg, finish, now, phase, results, startAt]);

  /* 모의 대회를 마치거나(결과) 그만두면(설정) 전체 화면을 푼다 */
  useEffect(() => {
    if (phase === 'setup' || phase === 'done') fs.exit();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 모의 대회의 카운트다운·측정 동안에는 앱 머리말과 아래 탭도 내린다(방해 요소 없는 화면) */
  useFocusMode(phase === 'countdown' || (!!cfg?.contest && phase === 'asking'));

  const cur = queue[idx];
  const contestRun = phase === 'countdown' || !!cfg?.contest;

  /*
   * 단축키 — 숫자 키로 답(코드는 0~6, 요일은 규정의 요일 번호), Tab = 모름(연습만), Esc = 중단(연습) · 취소(모의 대회).
   * 결과 화면의 키(공개 중 아무 키 = 건너뛰기, 끝난 뒤 Enter = 한 판 더)는 ResultSheet 가 맡는다.
   */
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'asking' && phase !== 'feedback') return;
    const onKey = (e: KeyboardEvent) => {
      // 성적표에서 Enter(한 판 더)로 새 판이 열리면 같은 키가 여기까지 온다 — 이미 처리된 키는 받지 않는다
      if (e.defaultPrevented || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); if (contestRun) cancel(); else stop(); return; }
      if (phase === 'feedback') {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); continueAfterWrong(); }
        return;
      }
      if (phase !== 'asking' || !cur || !cfg) return;
      if (e.key === 'Tab') { e.preventDefault(); if (!cfg.contest) press(null); return; }
      /* 마우스로 누른 자판·버튼에 남은 포커스를 Enter·Space 가 다시 누르지 않게 — 측정 중 답은 숫자 키와 자판 누름으로만 */
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return; }
      if (e.repeat || !/^[0-9]$/.test(e.key)) return;
      const k = Number(e.key);
      const wd = asksWeekday(cur, step);
      const v = wd ? keyToWeekday(k, cfg.base) : k <= 6 ? k : null;
      if (v == null) return;
      e.preventDefault();
      /* 키로 눌러도 그 자판에 눌림이 보인다 */
      pressVisual(keyRefs.current[wd ? weekdayOrder(cfg.base).indexOf(v) : v]);
      press(v);
    };
    /* 전체 화면에서는 브라우저가 첫 Esc 를 '전체 화면 나가기'로 가져가 keydown 이 오지 않는다 → 풀리면 취소로 본다 */
    const onFs = () => { if (contestRun && !document.fullscreenElement) cancel(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [cancel, cfg, continueAfterWrong, contestRun, cur, phase, press, step, stop]);

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    const contest = level.drill === 'contest';
    const [from, to] = rules ? yearsFor(level, rules) : [1600, 2099];
    const limit = limitSet || DEFAULT_LIMIT;
    /** 칸을 고르면 위의 '이번 판' 이 보이게 올린다 */
    const pick = (n: number) => {
      setPicked(n);
      folderRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    };
    return (
      <div className="flex flex-col gap-4">
        <header>
          <div className="flex items-center justify-between gap-2">
            <Dymo tone="blue" small>계산 종목</Dymo>
            <KeyLink to="/calc/calendar" tone="cream" size="sm">종목 화면</KeyLink>
          </div>
          <h1 className="mt-4 font-sign text-[40px] leading-[1.05] text-ink">달력</h1>
          <p className="mt-1.5 font-typek text-xs text-ink-2">
            요일 번호(규정) — {base === 'mon1' ? '월요일 = 1 … 일요일 = 7' : '일요일 = 0 … 토요일 = 6'}
          </p>
        </header>

        <div ref={folderRef} className="scroll-mt-16">
          <Folder tab="이번 판" clip>
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-xl leading-tight text-ink">{level.n}. {level.name}</h2>
                <p className="mt-1 text-sm text-ink-2">{level.what}{level.drill !== 'code' && ` · ${from}–${to}년`}</p>
              </div>
              {!contest && (
                <Field label="문항 수">
                  <input className="tnum w-28" type="number" min={5} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </Field>
              )}
              {level.drill === 'full' && (
                <label className="flex items-start gap-2 font-typek text-[13px] text-ink">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={stepsOn} onChange={(e) => setStepsOn(e.target.checked)} />
                  <span>단계 입력 — 연도 코드 → 월 코드 → 요일을 차례로 눌러 단계마다 시간을 잽니다</span>
                </label>
              )}
              {contest && (
                <p className="m-0 rounded-[4px] bg-card px-3 py-2.5 font-typek text-xs leading-relaxed text-ink-2">
                  제한시간 {limit}초 · 오답 감점 {Number(rules?.penaltyPerWrong) || 0}점 · 시작하면 전체 화면
                  {!limitSet && <><br />규정 제한시간이 비어 있어 {DEFAULT_LIMIT}초로 치릅니다.</>}
                </p>
              )}
              <Key tone="red" size="big" disabled={!rules} onClick={begin}>시작</Key>
            </div>
          </Folder>
        </div>

        <section className="flex flex-col gap-2.5">
          <Dymo small className="self-start">사다리</Dymo>
          {CAL_LEVELS.map((l, i) => {
            const s = ladder?.statuses[i];
            const meta = [s?.passed && '통과', ladder?.current.n === l.n && '지금 칸'].filter(Boolean).join(' · ');
            return (
              <IndexCard
                key={l.id}
                title={`${l.n}. ${l.name}`}
                meta={meta || undefined}
                body={l.pass ? l.what : `${limit}초 · ${ladder?.best ? `최고 ${ladder.best}점` : '아직 기록 없음'}`}
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
        <KeyLink to="/calc/calendar" tone="cream" className="flex-1">종목 화면</KeyLink>
      </div>
    );
    if (!outcome) {
      return (
        <Panel title="달력">
          <Empty>기록된 문항이 없습니다.</Empty>
          <div className="flex flex-col gap-4">
            <Key tone="red" size="big" onClick={begin}>한 번 더</Key>
            {actions}
          </div>
        </Panel>
      );
    }
    const wrongs = results.filter((r) => !r.isCorrect);
    const avgs = cfg?.contest ? [] : okStepAverages(results);
    const slowest = avgs.length > 1 ? Math.max(...avgs.map((a) => a.avgMs)) : -1;
    /* 신기록 무대가 화면 뒤를 덮으므로 함께 볼 상세는 children 으로 넘긴다 */
    return (
      <ResultSheet outcome={outcome} onAgain={begin} actions={actions}>
        {avgs.length > 0 && (
          <Panel title="단계별 평균 시간">
            <div className="grid grid-cols-3 gap-2">
              {avgs.map((a) => (
                <Stat
                  key={a.name}
                  label={a.name}
                  value={`${(a.avgMs / 1000).toFixed(2)}초`}
                  sub={a.avgMs === slowest ? <b className="text-ink">가장 느림</b> : `${a.n}번`}
                />
              ))}
            </div>
          </Panel>
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
  const showing = held ? held.item : cur;
  const left = startAt + cfg.limitSec * 1000 - now;
  const ask = cfg.contest ? '요일'
    : cfg.drill === 'year' ? '연도 코드'
    : cfg.drill === 'code' ? '코드'
    : cfg.params.steps ? '연도 코드 → 월 코드 → 요일' : '요일';
  /* 안내 줄은 늘 한 줄 — 카드 높이가 문제마다 달라지지 않는다. '윤년' 은 코드 드릴에서만 문제의 일부다 */
  const help = (
    <>
      {cfg.drill === 'code' && showing.note && <><b className="text-ink">{showing.note}</b> · </>}
      {ask}{!cfg.contest && ' · Tab 모름'}
    </>
  );
  const heldStep = held?.wrongStep ? held.item.steps?.find((s) => s.name === held.wrongStep) : undefined;

  return (
    <div className="flex flex-col gap-3">
      {!cfg.contest && judge.layer}

      <div className="flex items-center gap-3">
        {!cfg.contest && <span className="tnum text-[13px] text-ink-2">{mmss(Math.floor((now - startAt) / 1000))}</span>}
        <Btn size="sm" className="ml-auto" onClick={cfg.contest ? cancel : stop}>{cfg.contest ? '취소 (Esc)' : '중단 (Esc)'}</Btn>
      </div>

      {cfg.contest ? (
        <Hud
          left={<>달력 · 모의 대회 · <b>{idx + 1}</b>번째</>}
          right={<Clock sec={Math.max(0, Math.ceil(left / 1000))} warn={left <= 10_000} />}
        />
      ) : (
        <Hud left={<>달력 · {cfg.level.name} · <b>{idx + 1}</b>/{queue.length}</>} streak={streak} judge={judge} />
      )}

      <QuestionCard ref={cardRef} size={SIZE[cfg.drill]} prompt={showing.prompt} help={help}>
        {showing.steps && <StepSlots steps={showing.steps} filled={held ? held.steps ?? [] : stepLog} />}
      </QuestionCard>

      {phase === 'asking' && (
        <>
          {cur.steps && <p className="m-0 text-center font-typek text-[12px] text-ink-2">{cur.steps[step].name}</p>}
          <AnswerKeys weekday={asksWeekday(cur, step)} base={cfg.base} keyRefs={keyRefs} onPress={press} />
          {!cfg.contest && (
            <div className="flex justify-center pt-1">
              <Key tone="cream" sub="Tab" onClick={() => press(null)}>모름</Key>
            </div>
          )}
        </>
      )}

      {held && (
        <>
          <Held>
            <div>
              정답 <b>{valText(held.item.kind === 'full', held.item.expected)}</b>
              {held.item.kind === 'full' && <> · 숫자 {weekdayKey(held.item.expected, cfg.base)}</>}
            </div>
            <div className="mt-0.5">
              {heldStep ? (
                <>{heldStep.name}에서 틀렸습니다 — 입력 <span className="font-type font-bold text-blue">{held.given}</span> · 정답 {heldStep.expected}</>
              ) : held.given ? (
                <>입력한 답 <span className="font-type font-bold text-blue">{valText(held.item.kind === 'full', held.given)}</span></>
              ) : (
                '모름으로 넘겼습니다'
              )}
            </div>
            <div className="mt-1 text-[12px] leading-snug">{explain(held.item)}</div>
          </Held>
          <Key size="big" sub="Enter" onClick={continueAfterWrong}>계속</Key>
        </>
      )}
    </div>
  );
}

/** 단계별 평균은 맞힌 단계만 — 틀린 단계는 셈을 끝낸 시간이 아니다 */
const okStepAverages = (rs: Result[]) => stepAverages(rs.map((r) => ({ steps: r.steps?.filter((s) => s.ok) })));

/** 머리띠 오른쪽 시계(남은 시간). 마지막 10초만 빨강 — 측정 화면의 강조는 이 한 곳이다 */
function Clock({ sec, warn }: { sec: number; warn: boolean }) {
  return <span className={`tnum text-[26px] font-bold leading-none ${warn ? 'text-red' : 'text-ink'}`}>{mmss(sec)}</span>;
}

/** 답 자판 일곱 — 코드면 0~6, 요일이면 요일 이름과 그 아래 누를 숫자(규정의 요일 번호) */
function AnswerKeys({ weekday, base, keyRefs, onPress }: {
  weekday: boolean; base: WeekBase; keyRefs: RefObject<(HTMLButtonElement | null)[]>; onPress: (v: number) => void;
}) {
  const vals = weekday ? weekdayOrder(base) : CODES;
  return (
    <div className="flex justify-center gap-2 pt-1" role="group" aria-label={weekday ? '요일' : '코드'}>
      {vals.map((v, i) => (
        <Key
          key={i}
          ref={(el) => { keyRefs.current[i] = el; }}
          tone="cream"
          size="round"
          style={CELL}
          className="tnum"
          sub={weekday ? weekdayKey(v, base) : undefined}
          onClick={() => onPress(v)}
        >
          {weekday ? WEEKDAY_KO[v] : v}
        </Key>
      ))}
    </div>
  );
}

/** 단계 입력 칸 — 모양은 고정, 친 값만 채워진다. 붙잡힌 뒤 틀린 칸은 파란 연필 */
function StepSlots({ steps, filled }: { steps: CalStepSpec[]; filled: CalcStep[] }) {
  return (
    <div className="flex gap-2">
      {steps.map((s, i) => {
        const got = filled[i];
        return (
          <span key={s.name} className="flex w-[84px] flex-col items-center gap-1">
            <span className="font-typek text-[10px] text-ink-2">{s.name}</span>
            <span className={`grid h-11 w-full place-items-center border-b-2 border-ink-2 bg-input font-type text-[22px] font-bold leading-none ${got?.ok === false ? 'text-blue' : 'text-ink'}`}>
              {got?.given ? (s.name === '요일' ? WEEKDAY_KO[Number(got.given)] : got.given) : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** 사다리 칸의 세 조건 — 성적표 목표 막대와 같은 모양(lp-bar), 빨간 세로선이 기준 */
function Bars({ bars }: { bars: OutcomeGoal[] }) {
  return (
    <div className="lp-bars">
      {bars.map((b) => (
        /* 오른쪽 칸은 '12.40초' 가 들어가도록 글자 폭만큼 */
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
  const wd = r.item.kind === 'full';
  const spec = r.wrongStep ? r.item.steps?.find((s) => s.name === r.wrongStep) : undefined;
  return (
    <li className="border-b border-card-edge py-1.5 font-typek text-[13px] last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tnum text-[15px] font-bold text-ink">{r.item.prompt}</span>
        {r.item.kind === 'month' && r.item.note && <span className="text-[11px] text-ink-2">{r.item.note}</span>}
        <span className="text-ink-2">→</span>
        <span className="text-ink">{valText(wd, r.item.expected)}</span>
        <span className="ml-auto text-blue">
          {!r.given ? '모름' : spec ? `${spec.name} ${r.given} (정답 ${spec.expected})` : `입력 ${valText(wd, r.given)}`}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-ink-2">{explain(r.item)}</div>
    </li>
  );
}
