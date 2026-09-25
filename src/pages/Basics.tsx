import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import {
  db, getSettings, saveSettings,
  type DrillAttempt, type ImageSet, type ImageStat, type MemoImage, type PickMode, type StimulusStyle, type Verdict,
} from '../db/db';
import { recordAttempt, undoAttempt } from '../db/record';
import { buildQueue, median, rank } from '../lib/srs';
import { codeOfName, matchName, type ChosungMap, type MatchKind } from '../lib/hangul';
import { cardLabel, fullDeck, resolveCard } from '../lib/cards';
import { pickOne, randBelow, uid } from '../lib/random';
import { streaks } from '../lib/streak';
import type { RunOutcome } from '../lib/outcome';
import MappingDrill from './MappingDrill';
import { type Stage } from '../lib/mapping';
import { goalFor } from '../db/goals';
import { loadSummaries } from '../db/sessions';
import { drillOutcome, type DrillRun } from '../db/drillOutcome';
import GoalPanel from '../components/GoalPanel';
import ImageEditDialog from '../components/ImageEditDialog';
import CourseBar from '../components/CourseBar';
import { useCoachReview } from '../components/CoachReview';
import { courseStep } from '../coach';
import { isTyping } from '../App';
import { Empty, Field, Panel, fmtMs, fmtPct } from '../components/ui';
import { Dymo, Folder, Held, Hud, Key, KeyLink, QuestionCard, ResultSheet, useJudge } from '../components/lp';

type Phase = 'setup' | 'asking' | 'feedback' | 'done';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

interface Trial {
  image: MemoImage;
  display: string;
  /** 카드로 출제된 경우 원본 카드 코드 */
  stimulus?: string;
}

interface Result {
  trial: Trial;
  rtMs: number;
  verdict: Verdict;
  typedInput?: string;
  typedMatch?: MatchKind;
  /** 되돌리기용 — 지울 원시 기록과 그 전의 통계 */
  attemptId: string;
  prevStat?: ImageStat;
}

const MODE_LABEL: Record<PickMode, string> = {
  srs: '약점 우선 (간격 반복)',
  all: '전체 무작위',
  weak: '약점만',
  unseen: '아직 안 본 것',
};

/** 이름의 초성이 그 칸의 숫자와 맞는가. 숫자 세트에서만 따진다. */
function badChosung(img: MemoImage, domain?: string, map?: ChosungMap): boolean {
  if (!map || (domain !== 'digit2' && domain !== 'digit3') || !img.name.trim()) return false;
  const code = codeOfName(img.name, map);
  return !(code && code.startsWith(img.key));
}

/**
 * 한 판 → 성적표 입력. 반응시간은 잰 값만(모름은 0 이라 빠진다) 평균낸다 —
 * 통합 기록(db/sessions.ts)의 perItemMs 와 같은 기준이라 지난 판과 그대로 견줄 수 있다.
 */
function drillRun(final: Result[], totalMs: number): DrillRun {
  const rts = final.map((r) => r.rtMs).filter((x) => x > 0);
  return {
    items: final.length,
    correct: final.filter((r) => r.verdict === 'correct').length,
    meanRtMs: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0,
    maxStreak: streaks(final.map((r) => r.verdict === 'correct')).best,
    totalMs,
  };
}

export default function Drill() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const images = useLiveQuery(() => db.images.toArray(), [], [] as MemoImage[]);
  const stats = useLiveQuery(() => db.imageStats.toArray(), [], [] as ImageStat[]);
  const settings = useLiveQuery(() => getSettings(), []);
  const m1 = useLiveQuery(() => goalFor(1), []);
  const m2 = useLiveQuery(() => goalFor(2), []);
  const m3 = useLiveQuery(() => goalFor(3), []);

  /**
   * 단계는 주소에 둔다 (`/basics?stage=2`).
   *
   * 화면 상태로만 두면 2단계에서 뒤로가기를 눌렀을 때 3단계가 아니라 이 화면에 오기 전
   * 페이지(홈·자산)로 튄다 — 브라우저가 아는 것은 주소뿐이기 때문이다. 주소에 두면
   * 뒤로가기가 단계 사이를 오가고, 특정 단계로 바로 잇는 링크도 생긴다.
   */
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('stage'));
  const stage: Stage | 3 = raw === 1 ? 1 : raw === 2 ? 2 : 3;
  /* 같은 단계를 다시 누르면 방문 기록만 쌓이므로 아무것도 안 한다 */
  const setStage = (n: Stage | 3) => { if (n !== stage) setParams({ stage: String(n) }); };
  const [selected, setSelected] = useState<string[]>([]);
  /**
   * 숫자 세트는 앞자리로 열 묶음을 낸다 (00–09, 10–19 …).
   * 100칸을 한꺼번에 돌리면 오늘 뭘 외웠는지가 흐려진다. 한 줄씩 끊어 붙이는 쪽이 는다.
   * 비어 있으면 '전부'를 뜻한다.
   */
  const [decades, setDecades] = useState<Record<string, string[]>>({});
  const [mode, setMode] = useState<PickMode>('srs');
  const [style, setStyle] = useState<StimulusStyle>('key');
  const [count, setCount] = useState(30);

  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Trial[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [typedInput, setTypedInput] = useState('');
  /** 한/영이 영문에 있을 때. 오답으로 세지 않고 알려만 준다 — 몰라서 틀린 게 아니다. */
  const [imeHint, setImeHint] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [streak, setStreak] = useState(0);
  const [undoing, setUndoing] = useState(false);
  /** 결과 표에서 고칠 이미지. 팝업으로 세트 편집기와 같은 상자를 띄운다. */
  const [editId, setEditId] = useState<string | null>(null);
  /** 성적표. 기록을 다 저장한 뒤 목표·지난 판과 견줘 만든다(만드는 동안은 null). */
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const sessionStart = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalMs, setTotalMs] = useState(0);

  const t0 = useRef(0);
  const rtRef = useRef(0);
  const typedRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  /** 문제 카드 — 조각이 넘지 않을 윗선을 재고, 틀려서 붙잡힌 뒤 한 번 흔드는 데만 쓴다 */
  const cardRef = useRef<HTMLDivElement>(null);
  const judge = useJudge();
  const { show: showJudge, shake: shakeCard, reset: resetJudge } = judge;
  /* 스승님 복기 — 기록된 문항이 있는 결과에서만 */
  const coach = useCoachReview('drill', phase === 'done' && results.length > 0 ? sessionId : '');

  /**
   * 마지막에 쓰신 설정을 되살린다.
   *
   * 처음 한 번만 읽는다. 그 뒤로는 화면이 원본이고, 저장은 아래 effect 가 한쪽으로만 한다.
   * 매번 읽으면 저장 → 다시 읽기 → 덮어쓰기로 회장 조작이 되돌려진다.
   */
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !settings) return;
    loaded.current = true;
    setCount(settings.drillCount);
    setMode(settings.drillPickMode ?? 'srs');
    setStyle(settings.drillStyle ?? 'key');
    setDecades(settings.drillDecades ?? {});
  }, [settings]);

  /** 세트는 따로 — 저장된 것이 없거나 지워진 세트면 '이름이 있는 세트 전부'로 떨어진다. */
  const setsPicked = useRef(false);
  useEffect(() => {
    if (setsPicked.current || !settings || sets.length === 0) return;
    const saved = (settings.drillSetIds ?? []).filter((id) => sets.some((s) => s.id === id));
    if (saved.length) {
      setSelected(saved);
      setsPicked.current = true;
      return;
    }
    if (images.length === 0) return; // 기본값을 고르려면 이미지가 있어야 한다
    const withNames = sets.filter((s) => images.some((i) => i.setId === s.id && i.name.trim()));
    setSelected((withNames.length ? withNames : sets).map((s) => s.id));
    setsPicked.current = true;
  }, [settings, sets, images]);

  /*
   * 코스로 열면 주소의 문항 수(?n)·출제 방식(?pick)을 이번 판에만 쓴다 — 저장된 기본 설정은 덮어쓰지 않는다.
   * 되살리기(위) 다음에 돌아야 이긴다. 주소에서 값이 빠지면(단계 탭 등) 저장된 값으로 돌아간다.
   * 설정 칸을 직접 바꾸시면 그 값은 주소 몫이 아니므로 다시 저장된다.
   */
  const search = params.toString();
  const course = courseStep(params);
  const fromUrl = useRef({ count: false, mode: false });
  useEffect(() => {
    if (!loaded.current || !settings) return;
    const n = stage === 3 ? Math.round(Number(params.get('n'))) : 0;
    const pick = stage === 3 ? params.get('pick') : null;
    if (n > 0) { setCount(Math.min(300, Math.max(5, n))); fromUrl.current.count = true; }
    else if (fromUrl.current.count) { setCount(settings.drillCount); fromUrl.current.count = false; }
    if (pick && Object.hasOwn(MODE_LABEL, pick)) { setMode(pick as PickMode); fromUrl.current.mode = true; }
    else if (fromUrl.current.mode) { setMode(settings.drillPickMode ?? 'srs'); fromUrl.current.mode = false; }
    /* 코스의 다음 항목으로 넘어왔는데 지난 판 결과가 남아 있으면 설정부터 */
    if (course) setPhase((p) => (p === 'done' ? 'setup' : p));
  }, [search, !!settings]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 바뀔 때마다 저장. 되살리기가 끝난 뒤에만 쓴다. 주소에서 온 값은 이번 판 몫이라 저장하지 않는다. */
  useEffect(() => {
    if (!loaded.current || !setsPicked.current) return;
    saveSettings({
      drillSetIds: selected, drillDecades: decades, drillStyle: style,
      ...(fromUrl.current.mode ? {} : { drillPickMode: mode }),
      ...(fromUrl.current.count ? {} : { drillCount: count }),
    });
  }, [selected, decades, mode, style, count]);

  /** 이미지 키 -> 그 이미지를 가리키는 카드들 */
  const cardsByImage = useMemo(() => {
    if (!settings) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    const bySetKey = new Map(images.map((i) => [`${i.setId}:${i.key}`, i]));
    const setByDomain = new Map(sets.map((s) => [s.domain, s]));
    for (const code of fullDeck()) {
      const r = resolveCard(code, settings.suitDigits, settings.rankDigits);
      if (!r) continue;
      const set = setByDomain.get(r.domain);
      if (!set) continue;
      const img = bySetKey.get(`${set.id}:${r.key}`);
      if (!img || !img.name.trim()) continue;
      map.set(img.id, [...(map.get(img.id) ?? []), code]);
    }
    return map;
  }, [images, sets, settings]);

  /** 고른 세트·열 묶음 안에서 이름이 채워진 칸 (자극 형태는 아직 안 따진다) */
  const inRange = useMemo(
    () =>
      images.filter((i) => {
        if (!selected.includes(i.setId) || !i.name.trim()) return false;
        const picked = decades[i.setId];
        return !picked || picked.length === 0 || picked.includes(i.key[0]);
      }),
    [images, selected, decades],
  );

  /**
   * 실제로 출제할 칸.
   *
   * '카드' 로 내라고 하셨으면 **카드가 붙는 칸만** 낸다. 무늬가 1~4 라 00~09 처럼 카드가
   * 없는 칸이 섞이는데, 그대로 두면 카드를 고르셨는데 숫자가 나온다 — 회장이 "카드를 안
   * 골랐는데 카드가 나온다" 로 느끼신 혼선의 뒷면이다.
   */
  const pool = useMemo(
    () => (style === 'card' ? inRange.filter((i) => cardsByImage.has(i.id)) : inRange),
    [inRange, style, cardsByImage],
  );

  const start = useCallback(async () => {
    const statMap = new Map(stats.map((s) => [s.imageId, s]));
    const ranked = rank(pool, statMap);
    const picked = buildQueue(ranked, count, mode);
    if (picked.length === 0) return;

    const trials: Trial[] = picked.map((image) => {
      const cards = cardsByImage.get(image.id) ?? [];
      const useCard = cards.length > 0 && (style === 'card' || (style === 'mix' && randBelow(2) === 0));
      if (!useCard) return { image, display: image.key };
      const code = pickOne(cards);
      return { image, display: cardLabel(code), stimulus: code };
    });

    const id = uid();
    await db.drillSessions.add({
      id, startedAt: Date.now(), setIds: selected, pickMode: mode,
      itemCount: trials.length, typedCheckRate: 1,
    });
    setSessionId(id);
    setQueue(trials);
    setResults([]);
    setIdx(0);
    sessionStart.current = Date.now();
    setElapsed(0);
    setStreak(0);
    setTypedInput('');
    setImeHint(false);
    setOutcome(null);
    resetJudge();
    setPhase('asking');
  }, [cardsByImage, count, mode, pool, resetJudge, selected, stats, style]);

  const finish = useCallback(async (final: Result[]) => {
    const now = Date.now();
    if (sessionId) await db.drillSessions.update(sessionId, { endedAt: now });
    const total = now - sessionStart.current;
    setTotalMs(total);
    setResults(final);
    setOutcome(null);
    setPhase('done');
    /*
     * 성적표는 기록을 다 저장한 뒤에 만든다. 목표 막대는 이 판까지 넣은 단계 목표,
     * 신기록·아까움은 같은 단계의 지난 판(이번 판 제외, 최근 것이 앞)과 견준 실제 값이다.
     */
    const [goal, all] = await Promise.all([goalFor(3), loadSummaries()]);
    const past = all.filter((s) => s.disciplineId === 'basics-3' && s.id !== sessionId);
    setOutcome(drillOutcome({ run: drillRun(final, total), goal, past, goalAccuracy: goal.rule.accuracy }));
  }, [sessionId]);

  /**
   * 채점은 타이핑으로만 한다.
   *
   * 예전에는 스페이스로 '떠올랐다'를 표시하고 회장이 맞음/틀림을 직접 눌렀다. 자가 채점은
   * 손이 미끄러질 수 있고, 무엇보다 **떠올렸다고 믿은 것과 실제로 떠올린 것을 구분하지 못한다.**
   * 이름을 쳐야만 넘어가게 하면 그 구분이 사라진다.
   *
   * 정답 기준은 **이름 그대로(또는 별칭)** 다. 초성만 맞은 것은 오답으로 센다 — '82'에서 'ㅈㄴ'
   * 는 이미지를 떠올리지 않고 2단계 변환만 해도 나오기 때문이다. 그걸 정답으로 세면 3단계가
   * 2단계와 같아진다.
   */
  const submit = useCallback(async (giveUp = false) => {
    const trial = queue[idx];
    if (!trial || !settings || submitting.current) return;
    const raw = giveUp ? '' : typedInput.trim();
    if (!giveUp) {
      if (!raw) return;
      if (/^[A-Za-z ]+$/.test(raw)) { setImeHint(true); return; }
    }
    /*
     * 저장을 기다리는 사이에 Enter 가 한 번 더 들어오면(키 자동 반복 등) 같은 문항이 두 번 기록됐다.
     * 이 판정이 화면에 반영될 때까지 다음 제출을 받지 않는다.
     */
    submitting.current = true;
    try {

    const set = sets.find((s) => s.id === trial.image.setId);
    const m: MatchKind = giveUp ? 'none' : matchName(raw, trial.image, settings.chosungMap, set?.domain !== 'cardFace');
    const verdict: Verdict = !giveUp && (m === 'exact' || m === 'alias') ? 'correct' : 'wrong';
    /*
     * '모름' 은 오답으로 센다. 안 떠오른 것도 못 떠올린 것이고, 그래야 SRS 가 이 칸을 다시
     * 앞으로 당긴다. 다만 반응시간은 0 으로 둬 표본에서 빠지게 한다 — 포기까지 걸린 시간은
     * 회상 속도가 아니다.
     */
    const rtMs = giveUp ? 0 : rtRef.current;

    const attempt: DrillAttempt = {
      id: uid(), sessionId, order: idx,
      imageId: trial.image.id, setId: trial.image.setId, key: trial.image.key,
      stimulus: trial.stimulus, rtMs, verdict,
      typedInput: raw || undefined, typedMatch: m, shownAt: Date.now(),
    };
    const prevStat = await recordAttempt(attempt);
    const next = [...results, { trial, rtMs, verdict, typedInput: raw || undefined, typedMatch: m, attemptId: attempt.id, prevStat }];

    setResults(next);
    setTypedInput('');
    setImeHint(false);

    /*
     * 판정 연출은 머리띠(계수기·판정 글자·연필 표시)와 연출 층에서만 돈다. 문제 카드에는 아무것도 걸지 않는다 —
     * 맞으면 다음 문제가 곧바로 떠서 연출이 다음 문제의 반응시간 측정과 겹치기 때문이다.
     */
    if (verdict === 'correct') {
      /* 맞으면 멈추지 않는다. 틀리거나 모르면 이름을 보여주고 붙잡는다 (1·2단계와 같다). */
      const n = streak + 1;
      setStreak(n);
      showJudge('good', n, cardRef.current);
      if (idx + 1 >= queue.length) await finish(next);
      else setIdx(idx + 1);
    } else {
      setStreak(0);
      showJudge(giveUp ? 'skip' : 'bad');
      setPhase('feedback');
      /* 붙잡힌 뒤(측정이 끝난 뒤)에만 카드를 한 번 흔든다 */
      if (!giveUp) shakeCard(cardRef.current);
    }
    } catch (e) {
      submitting.current = false;
      throw e;
    }
  }, [finish, idx, queue, results, sessionId, sets, settings, shakeCard, showJudge, streak, typedInput]);

  /* 판정이 화면에 그려진 뒤(다음 문항·붙잡힘·결과로 바뀐 뒤)에야 다음 제출을 받는다 */
  useEffect(() => { submitting.current = false; }, [idx, phase, results]);

  const continueAfterWrong = useCallback(() => {
    if (idx + 1 >= queue.length) finish(results);
    else { setIdx(idx + 1); setPhase('asking'); }
  }, [finish, idx, queue.length, results]);

  /**
   * 한 문제 뒤로 — 오타로 넘어갔을 때.
   *
   * 화면만 되돌리면 기록은 틀린 채로 남는다. 원시 기록과 통계까지 같이 되돌리고 그 문제를
   * 다시 낸다. 누를 때마다 한 칸씩 뒤로 가므로 몇 문제 전으로도 돌아갈 수 있다.
   */
  const undo = useCallback(async () => {
    if (undoing) return;
    const last = results[results.length - 1];
    if (!last) return;
    setUndoing(true);
    try {
      await undoAttempt(last.attemptId, last.trial.image.id, last.prevStat);
      if (phase === 'done' && sessionId) await db.drillSessions.update(sessionId, { endedAt: undefined });
      const rest = results.slice(0, -1);
      setResults(rest);
      setStreak(streaks(rest.map((r) => r.verdict === 'correct')).cur);
      setIdx(rest.length);
      setTypedInput('');
      setImeHint(false);
      setPhase('asking');
    } finally {
      setUndoing(false);
    }
  }, [phase, results, sessionId, undoing]);

  /** 반응시간은 **첫 글자를 치기까지**로 잰다. 타자 속도가 아니라 이미지가 떠오른 때가 알고 싶다. */
  const onType = (v: string) => {
    if (!rtRef.current && v) rtRef.current = Math.round(performance.now() - t0.current);
    setTypedInput(v);
    if (imeHint) setImeHint(false);
  };

  useEffect(() => {
    if (phase !== 'asking') return;
    t0.current = performance.now();
    rtRef.current = 0;
    /* requestAnimationFrame 을 쓰지 않는다 — 창이 그리지 않는 동안에는 콜백이 오지 않아
       입력칸에 포커스가 안 잡히고, 그러면 아무리 쳐도 글자가 안 들어간다. */
    typedRef.current?.focus();
  }, [phase, idx]);

  useEffect(() => {
    if (phase === 'setup' || phase === 'done') return;
    const t = setInterval(() => setElapsed(Date.now() - sessionStart.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  /* 드릴 단축키 — 입력칸 안에서 오는 키는 입력칸이 먼저 처리한다 */
  useEffect(() => {
    if (phase === 'setup' || phase === 'done') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(results); return; }
      if (isTyping(e.target)) return;
      if (phase === 'feedback') {
        if (e.key === 'Enter' || e.code === 'Space' || e.key === ' ') { e.preventDefault(); continueAfterWrong(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [continueAfterWrong, finish, phase, results, undo]);

  const stageTabs = (
    <nav aria-label="기초 단계" className="grid grid-cols-3 gap-3 pt-1">
      {([
        { n: 1 as const, desc: '자음 하나', m: m1 },
        { n: 2 as const, desc: '자음 두 개', m: m2 },
        { n: 3 as const, desc: '이미지', m: m3 },
      ]).map((t) => {
        const on = stage === t.n;
        return (
          <div key={t.n} className="flex flex-col items-center gap-1.5">
            {/* 고른 단계는 눌려 고정된 남색 자판, 나머지는 크림색 */}
            <Key
              tone={on ? 'ink' : 'cream'}
              size="sm"
              sub={t.desc}
              aria-current={on ? 'page' : undefined}
              onClick={() => setStage(t.n)}
              className={on ? 'w-full is-down' : 'w-full'}
            >
              {t.n}단계
            </Key>
            {t.m && t.m.attempts > 0 && (
              <span className="tnum text-center text-[11px] leading-tight text-ink-2">
                {fmtPct(t.m.accuracy)} · {fmtMs(t.m.medianRt)}
                {t.m.passed && <b className="block font-typek text-chalk">통과</b>}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );

  /* 훈련 중에는 탭을 내린다 — 휴대폰에서 문제가 화면 아래로 밀려나면 못 쓴다 */
  if (stage !== 3) return <MappingDrill stage={stage} header={stageTabs} />;

  /* ───────── 설정 화면 ───────── */
  if (phase === 'setup') {
    const namedCount = pool.length;
    return (
      <div className="flex flex-col gap-5">
        <CourseBar step={course} />
        {stageTabs}
        <Folder tab="3단계 설정" clip>
          <h2 className="font-sign text-[22px] leading-tight text-ink">이미지 변환 드릴</h2>
          <div className="mt-3 flex flex-col gap-4">
            {/* 체크 상자가 여럿이라 Field(label) 로 감싸지 않는다 — label 안의 label 은 첫 칸을 대신 누른다 */}
            <div className="flex flex-col gap-2">
              <span className="font-typek text-[11px] font-bold tracking-wide text-ink-2">세트</span>
              {sets.map((s) => {
                const mine = images.filter((i) => i.setId === s.id && i.name.trim());
                const on = selected.includes(s.id);
                const isDigits = s.domain === 'digit2' || s.domain === 'digit3';
                const width = s.domain === 'digit3' ? 3 : 2;
                const picked = decades[s.id] ?? [];
                const toggleDecade = (d: string) =>
                  setDecades((cur) => {
                    const now = cur[s.id] ?? [];
                    const next = now.includes(d) ? now.filter((x) => x !== d) : [...now, d];
                    return { ...cur, [s.id]: next };
                  });

                return (
                  <div key={s.id}>
                    <label className="flex items-center gap-2 font-typek text-[14px] text-ink">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={on}
                        onChange={(e) =>
                          setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))
                        }
                      />
                      {s.name}
                    </label>

                    {on && isDigits && (
                      <div className="mt-1.5 pl-5">
                        <div className="grid grid-cols-5 gap-1">
                          {'0123456789'.split('').map((d) => {
                            /*
                             * '카드' 일 때는 카드가 붙는 칸만 센다.
                             * 무늬가 1~4 라 00~09 에는 붙는 카드가 아예 없다. 그대로 고를 수
                             * 있게 두면 골라도 아무것도 안 나와 고장으로 보인다.
                             */
                            const count = mine.filter(
                              (i) => i.key[0] === d && (style !== 'card' || cardsByImage.has(i.id)),
                            ).length;
                            const active = picked.length === 0 || picked.includes(d);
                            const from = d + '0'.repeat(width - 1);
                            const to = d + '9'.repeat(width - 1);
                            return (
                              <button
                                key={d}
                                type="button"
                                disabled={count === 0}
                                aria-pressed={active && count > 0}
                                onClick={() => toggleDecade(d)}
                                className={`rounded-[3px] border px-0.5 py-1 text-center leading-tight disabled:opacity-30 ${
                                  active && count > 0
                                    ? 'border-ink bg-ink text-paper'
                                    : 'border-card-edge bg-card text-ink-2'
                                }`}
                              >
                                <span className="tnum block text-[11.5px]">{from}–{to}</span>
                                <span className="tnum block text-[10px] opacity-75">{count}칸</span>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="mt-1 font-typek text-[11px] text-ink-2 underline hover:text-ink"
                          onClick={() => setDecades((c) => ({ ...c, [s.id]: [] }))}
                        >
                          전체
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Field label="출제 방식">
              <select className="w-full" value={mode} onChange={(e) => { fromUrl.current.mode = false; setMode(e.target.value as PickMode); }}>
                {(Object.keys(MODE_LABEL) as PickMode[]).map((m) => (
                  <option key={m} value={m}>{MODE_LABEL[m]}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="자극 형태">
                <select className="w-full" value={style} onChange={(e) => setStyle(e.target.value as StimulusStyle)}>
                  <option value="key">숫자 그대로</option>
                  <option value="card">카드로 (A~10)</option>
                  <option value="mix">섞기</option>
                </select>
              </Field>
              <Field label="문항 수">
                <input
                  type="number"
                  className="tnum w-full"
                  min={5}
                  max={300}
                  value={count}
                  onChange={(e) => { fromUrl.current.count = false; setCount(Number(e.target.value)); }}
                />
              </Field>
            </div>
          </div>

          <div className="mt-5">
            <Key tone="red" size="big" disabled={namedCount === 0} onClick={start}>시작</Key>
          </div>
          {namedCount === 0 && (
            <p className="mt-3 font-typek text-[12.5px] leading-relaxed text-ink">
              {inRange.length > 0 ? (
                '고르신 범위에는 카드로 낼 수 있는 칸이 없습니다. 자극 형태를 숫자로 바꾸시거나 다른 열 묶음을 고르십시오.'
              ) : (
                <>이름이 채워진 이미지가 없습니다. <Link to="/assets/sets" className="font-bold text-ink underline">이미지 세트</Link>에서 먼저 채워 주십시오.</>
              )}
            </p>
          )}
        </Folder>

        {m3 && (
          <section className="flex flex-col gap-2">
            <span><Dymo tone="red" small>3단계 목표</Dymo></span>
            <GoalPanel goal={m3} />
          </section>
        )}
      </div>
    );
  }

  /* ───────── 결과 화면 ───────── */
  if (phase === 'done') {
    const correct = results.filter((r) => r.verdict === 'correct');
    const rts = correct.map((r) => r.rtMs);
    return (
      <div className="flex flex-col gap-4">
        {/*
          * 성적표 하나로 — 글자판·목표 막대·금별·도장·아까움·신기록 무대가 다 들어 있다.
          * 공개 중 아무 키 = 건너뛰기, 끝난 뒤 Enter = 한 판 더 는 성적표가 스스로 처리한다(이 화면에 따로 Enter 처리를 두지 않는다).
          * 결과와 함께 보일 상세는 children 으로 넘긴다 — 신기록 무대가 성적표 뒤를 덮는다.
          */}
        {outcome && (
          <ResultSheet
            outcome={outcome}
            /* 이름 고치는 팝업이 떠 있는 동안에는 Enter 로 새 판이 시작되지 않게 */
            onAgain={() => { if (!editId) start(); }}
            sage={coach.sage}
            actions={
              <>
                {results.length > 0 && <CourseBar step={course} sessionId={sessionId} />}
                <div className="flex flex-wrap justify-center gap-3">
                  <Key tone="cream" size="sm" onClick={() => setPhase('setup')}>다시 설정</Key>
                  {results.length > 0 && (
                    <Key tone="cream" size="sm" disabled={undoing} onClick={undo}>← 마지막 문제 다시 풀기</Key>
                  )}
                  <KeyLink to="/stats" tone="cream" size="sm">기록 보기</KeyLink>
                </div>
                {coach.action}
              </>
            }
          >
            {m3?.passed && <GoalPanel goal={m3} celebrate />}
            {results.length === 0 ? (
              <Empty>기록된 문항이 없습니다.</Empty>
            ) : (
              <Panel
                title="문항별 기록"
                right={<span className="tnum text-[14px] text-ink">{correct.length}/{results.length}</span>}
              >
                <p className="mb-2 font-typek text-[11.5px] text-ink-2">
                  중앙 <span className="tnum text-ink">{fmtMs(median(rts))}</span> · 가장 느린{' '}
                  <span className="tnum text-ink">{fmtMs(Math.max(0, ...rts))}</span> · 문항당{' '}
                  <span className="tnum text-ink">{fmtMs(Math.round(totalMs / results.length))}</span>
                </p>
                {/* 한 줄에 한 문항. 목록이 길면 이 칸 안에서만 굴린다. */}
                <div className="max-h-[26rem] overflow-auto border-t border-card-edge">
                  {results.map((r, i) => {
                    const live = images.find((im) => im.id === r.trial.image.id) ?? r.trial.image;
                    const dom = sets.find((st) => st.id === live.setId)?.domain;
                    const ok = r.verdict === 'correct';
                    /* 맞힌 문항의 '치신 것' 은 이름과 같으니 굳이 다시 쓰지 않는다 */
                    const typed = ok && r.typedMatch === 'exact' ? null : (r.typedInput ?? '모름');
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setEditId(live.id)}
                        title="눌러서 이름 고치기"
                        className="flex w-full items-baseline gap-2 border-b border-card-edge px-1 py-1.5 text-left hover:bg-manila/60"
                      >
                        <span className="tnum w-9 shrink-0 text-[13px] text-ink-2">{r.trial.display}</span>
                        <span className="min-w-0 flex-1 truncate font-typek text-[14px] text-ink">{live.name || '—'}</span>
                        {badChosung(live, dom, settings?.chosungMap) && (
                          <span className="shrink-0 font-typek text-[11px] text-blue">초성 ✕</span>
                        )}
                        {typed && (
                          <span className={`max-w-[6rem] shrink truncate font-typek text-[11px] ${ok ? 'text-ink-2' : 'text-blue'}`}>{typed}</span>
                        )}
                        <span className="tnum w-12 shrink-0 text-right text-[12px] text-ink-2">{fmtMs(r.rtMs)}</span>
                        <span
                          className={`tnum w-3 shrink-0 text-center text-[14px] font-bold ${ok ? 'text-chalk' : 'text-blue'}`}
                          aria-label={ok ? '정답' : '오답'}
                        >
                          {ok ? '○' : '×'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 font-typek text-[11px] text-ink-2">줄을 누르면 그 이미지의 이름을 바로 고칠 수 있습니다.</p>
              </Panel>
            )}
          </ResultSheet>
        )}
        {editId && <ImageEditDialog imageId={editId} onClose={() => setEditId(null)} />}
      </div>
    );
  }

  /* ───────── 측정 화면 ───────── */
  const trial = queue[idx];
  if (!trial) return <Empty>출제할 문항이 없습니다.</Empty>;
  /* 틀려서 붙잡혀 있는 동안에는 방금 틀린 문제를 계속 보여 준다 */
  const last = phase === 'feedback' ? results[results.length - 1] : undefined;
  const shown = last?.trial ?? trial;

  return (
    <div className="flex flex-col gap-3">
      {judge.layer}
      <Hud left={<>이미지 3단계 · <b>{idx + 1}</b>/{queue.length}</>} streak={streak} judge={judge} />

      {/*
        * 문제 카드는 측정 동안 크기·위치·색이 변하지 않는다 — 연출 클래스를 걸지 말 것.
        * 확인·모름 자판과 한/영 안내도 카드 밖에 둔다(안에 두면 치는 동안 카드 안이 바뀐다).
        */}
      <div onClick={() => phase === 'asking' && typedRef.current?.focus()}>
        <QuestionCard ref={cardRef} prompt={shown.display} help="Enter 채점 · Tab 모름">
          {phase === 'asking' ? (
            <input
              ref={typedRef}
              value={typedInput}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                /* Tab = 모름. 글자를 만들지 않는 키라 치는 도중에 눌러도 안전하다 */
                else if (e.key === 'Tab') { e.preventDefault(); submit(true); }
                /*
                 * Backspace 는 글자 지우기 전용이다.
                 * 빈 칸일 때 앞 문제로 보내 봤더니, 치던 글자를 지우다가 한 번 더 눌리면
                 * 그대로 앞 문제로 넘어가 버렸다. 앞 문제는 '← 앞 문제' 를 눌러야만 간다.
                 */
              }}
              className="lp-question-input"
              placeholder="이미지 이름"
              aria-label="이미지 이름"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          ) : (
            /* 붙잡힌 동안에는 입력칸 자리만 남긴다 — 카드 모양이 그대로여야 다음 문제가 같은 모양으로 뜬다 */
            <div className="lp-question-input" aria-hidden>{' '}</div>
          )}
        </QuestionCard>
      </div>

      {phase === 'feedback' && last ? (
        <Held>
          <div className="flex items-baseline justify-between gap-3">
            <span>
              {last.typedInput ? <>치신 것 <span className="text-blue">{last.typedInput}</span></> : '모름'}
            </span>
            <span className="tnum text-[12px]">{fmtMs(last.rtMs)}</span>
          </div>
          <div className="mt-1">정답 <b>{last.trial.image.name}</b></div>
          {last.trial.image.note && <div className="mt-0.5 text-[12px]">{last.trial.image.note}</div>}
          {last.typedMatch === 'chosung' && (
            <div className="mt-1 text-[12px] font-bold text-red">초성은 맞았습니다 — 이름까지 떠올라야 합니다</div>
          )}
          <div className="mt-2.5">
            <Key size="sm" sub="Enter" onClick={continueAfterWrong}>계속</Key>
          </div>
        </Held>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {/* 휴대폰에는 Enter·Tab 이 잘 안 보인다 */}
          <div className="flex gap-3">
            <Key tone="cream" size="sm" sub="Enter" disabled={!typedInput.trim()} onClick={() => submit()}>확인</Key>
            <Key tone="cream" size="sm" sub="Tab" onClick={() => submit(true)}>모름</Key>
          </div>
          {imeHint && <p className="font-typek text-[12px] font-bold text-red">한/영을 한글로</p>}
        </div>
      )}

      <div className="flex items-center justify-between font-typek text-[12px] text-ink-2">
        <button
          type="button"
          className={`py-1 hover:text-ink disabled:opacity-40 ${results.length ? '' : 'invisible'}`}
          disabled={undoing}
          onClick={undo}
        >
          ← 앞 문제
        </button>
        <span className="tnum">{mmss(elapsed)}</span>
        <button type="button" className="py-1 hover:text-ink" onClick={() => finish(results)}>중단 (Esc)</button>
      </div>
    </div>
  );
}
