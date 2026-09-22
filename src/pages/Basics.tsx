import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import {
  db, getSettings, type DrillAttempt, type ImageSet, type ImageStat, type MemoImage, type PickMode, type Verdict,
} from '../db/db';
import { recordAttempt, undoAttempt } from '../db/record';
import { buildQueue, median, rank } from '../lib/srs';
import { codeOfName, hintForKey, matchName, type ChosungMap, type MatchKind } from '../lib/hangul';
import { cardLabel, fullDeck, resolveCard } from '../lib/cards';
import { pickOne, randBelow, uid } from '../lib/random';
import { streaks } from '../lib/streak';
import MappingDrill from './MappingDrill';
import { type Stage } from '../lib/mapping';
import { goalFor } from '../db/goals';
import GoalPanel from '../components/GoalPanel';
import { isTyping } from '../App';
import { Btn, Empty, Field, LinkBtn, Panel, Stat, Streak, fmtMs, fmtPct } from '../components/ui';

type Phase = 'setup' | 'asking' | 'feedback' | 'done';

const mmss = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
type Style = 'key' | 'card' | 'mix';

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
  srs: '약점 우선 (SRS)',
  all: '전체 무작위',
  weak: '약점만',
  unseen: '아직 안 본 것',
};

const MATCH_LABEL: Record<MatchKind, string> = {
  exact: '정확', alias: '별칭', chosung: '초성만', none: '불일치',
};

/**
 * 결과 표에서 이름을 바로 고친다.
 *
 * 이름이 안 붙는다는 걸 아는 순간이 바로 여기다 — 방금 틀린 줄을 보면서. 세트 편집기까지
 * 가라고 하면 그 순간을 놓친다. 초성이 키와 맞는지도 옆에서 바로 알려 준다.
 */
function NameCell({ image, map, isDigits }: { image: MemoImage; map: ChosungMap; isDigits: boolean }) {
  const [v, setV] = useState(image.name);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(image.name), [image.name]);

  const save = async () => {
    const name = v.trim();
    if (name === image.name) return;
    await db.images.update(image.id, { name, updatedAt: Date.now() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const code = isDigits && v.trim() ? codeOfName(v, map) : null;
  const bad = isDigits && !!v.trim() && !(code && code.startsWith(image.key));

  return (
    <span className="flex items-center gap-1.5">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        className={`w-full min-w-0 px-1.5 py-0.5 text-sm ${bad ? 'border-bad/60' : ''}`}
        aria-label={`${image.key} 이미지 이름`}
      />
      {bad && (
        <span className="shrink-0 text-[11px] text-bad" title={`초성이 ${hintForKey(image.key, map)} 이어야 합니다`}>
          초성 ✕
        </span>
      )}
      {saved && <span className="shrink-0 text-[11px] text-good">저장</span>}
    </span>
  );
}

export default function Drill() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const images = useLiveQuery(() => db.images.toArray(), [], [] as MemoImage[]);
  const stats = useLiveQuery(() => db.imageStats.toArray(), [], [] as ImageStat[]);
  const settings = useLiveQuery(() => getSettings(), []);
  const m1 = useLiveQuery(() => goalFor(1), []);
  const m2 = useLiveQuery(() => goalFor(2), []);
  const m3 = useLiveQuery(() => goalFor(3), []);

  const [stage, setStage] = useState<Stage | 3>(3);
  const [selected, setSelected] = useState<string[]>([]);
  /**
   * 숫자 세트는 앞자리로 열 묶음을 낸다 (00–09, 10–19 …).
   * 100칸을 한꺼번에 돌리면 오늘 뭘 외웠는지가 흐려진다. 한 줄씩 끊어 붙이는 쪽이 는다.
   * 비어 있으면 '전부'를 뜻한다.
   */
  const [decades, setDecades] = useState<Record<string, string[]>>({});
  const [mode, setMode] = useState<PickMode>('srs');
  const [style, setStyle] = useState<Style>('key');
  const [count, setCount] = useState(30);

  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Trial[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [typedInput, setTypedInput] = useState('');
  /** 한/영이 영문에 있을 때. 오답으로 세지 않고 알려만 준다 — 몰라서 틀린 게 아니다. */
  const [imeHint, setImeHint] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [undoing, setUndoing] = useState(false);

  const sessionStart = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalMs, setTotalMs] = useState(0);

  const t0 = useRef(0);
  const rtRef = useRef(0);
  const typedRef = useRef<HTMLInputElement>(null);

  /* 기본 선택: 채워진 이미지가 있는 세트 전부 */
  useEffect(() => {
    if (selected.length === 0 && sets.length > 0) {
      const withNames = sets.filter((s) => images.some((i) => i.setId === s.id && i.name.trim()));
      setSelected((withNames.length ? withNames : sets).map((s) => s.id));
    }
  }, [sets, images]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings) setCount(settings.drillCount);
  }, [settings?.drillCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = useMemo(
    () =>
      images.filter((i) => {
        if (!selected.includes(i.setId) || !i.name.trim()) return false;
        const picked = decades[i.setId];
        return !picked || picked.length === 0 || picked.includes(i.key[0]);
      }),
    [images, selected, decades],
  );

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
    setBestStreak(0);
    setTypedInput('');
    setImeHint(false);
    setFlash(null);
    setPhase('asking');
  }, [cardsByImage, count, mode, pool, selected, stats, style]);

  const finish = useCallback(async (final: Result[]) => {
    const now = Date.now();
    if (sessionId) await db.drillSessions.update(sessionId, { endedAt: now });
    setTotalMs(now - sessionStart.current);
    setResults(final);
    setPhase('done');
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
  const submit = useCallback(async () => {
    const trial = queue[idx];
    if (!trial || !settings) return;
    const raw = typedInput.trim();
    if (!raw) return;
    if (/^[A-Za-z ]+$/.test(raw)) { setImeHint(true); return; }

    const set = sets.find((s) => s.id === trial.image.setId);
    const m = matchName(raw, trial.image, settings.chosungMap, set?.domain !== 'cardFace');
    const verdict: Verdict = m === 'exact' || m === 'alias' ? 'correct' : 'wrong';

    const attempt: DrillAttempt = {
      id: uid(), sessionId, order: idx,
      imageId: trial.image.id, setId: trial.image.setId, key: trial.image.key,
      stimulus: trial.stimulus, rtMs: rtRef.current, verdict,
      typedInput: raw, typedMatch: m, shownAt: Date.now(),
    };
    const prevStat = await recordAttempt(attempt);
    const next = [...results, { trial, rtMs: rtRef.current, verdict, typedInput: raw, typedMatch: m, attemptId: attempt.id, prevStat }];

    setResults(next);
    setTypedInput('');
    setImeHint(false);
    setFlash(verdict === 'correct' ? 'good' : 'bad');
    setTimeout(() => setFlash(null), 340);

    if (verdict === 'correct') {
      /* 맞으면 멈추지 않는다. 틀렸을 때만 이름을 보여주고 붙잡는다 (1·2단계와 같다). */
      setStreak((v) => { const n = v + 1; setBestStreak((b) => Math.max(b, n)); return n; });
      if (idx + 1 >= queue.length) await finish(next);
      else setIdx(idx + 1);
    } else {
      setStreak(0);
      setPhase('feedback');
    }
  }, [finish, idx, queue, results, sessionId, sets, settings, typedInput]);

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
      const s = streaks(rest.map((r) => r.verdict === 'correct'));
      setResults(rest);
      setStreak(s.cur);
      setBestStreak(s.best);
      setIdx(rest.length);
      setTypedInput('');
      setImeHint(false);
      setFlash(null);
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
        else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [continueAfterWrong, finish, phase, results, undo]);

  const stageTabs = (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          { n: 1 as const, title: '1단계 · 자음 하나', desc: '숫자 ↔ ㄱㄴㄷ', m: m1 },
          { n: 2 as const, title: '2단계 · 자음 두 개', desc: '두 자리 ↔ 자음 두 개', m: m2 },
          { n: 3 as const, title: '3단계 · 이미지', desc: '자극 → 이미지 (본 훈련)', m: m3 },
        ]).map((t) => (
          <button
            key={t.n}
            onClick={() => setStage(t.n)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              stage === t.n ? 'border-accent bg-accent/15' : 'border-line bg-panel hover:border-accent/50'
            }`}
          >
            <div className="text-sm font-semibold">{t.title}</div>
            <div className="text-xs text-muted">{t.desc}</div>
            {t.m && t.m.attempts > 0 && (
              <div className="tnum mt-1 text-[11px] text-muted">
                정확도 {fmtPct(t.m.accuracy)} · {fmtMs(t.m.medianRt)}
                {t.m.passed && <span className="text-good"> · 통과</span>}
              </div>
            )}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        자음 매핑이 아직 안 붙으셨으면 1단계부터 하십시오. 이미지 드릴은 매핑이 자동으로 나온 뒤에 효과가 납니다.
      </p>
    </div>
  );

  /* 훈련 중에는 탭을 내린다 — 휴대폰에서 문제가 화면 아래로 밀려나면 못 쓴다 */
  if (stage !== 3) return <MappingDrill stage={stage} header={stageTabs} />;

  /* ───────── 설정 화면 ───────── */
  if (phase === 'setup') {
    const namedCount = pool.length;
    return (
      <div className="flex flex-col gap-4">
        {stageTabs}
        <Panel title="3단계 · 이미지 변환 드릴">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="세트">
              <div className="flex flex-col gap-2">
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
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={on}
                          onChange={(e) =>
                            setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))
                          }
                        />
                        {s.name} <span className="text-xs text-muted">({mine.length}개)</span>
                      </label>

                      {on && isDigits && (
                        <div className="mt-1.5 ml-6">
                          <div className="flex flex-wrap gap-1">
                            {'0123456789'.split('').map((d) => {
                              const count = mine.filter((i) => i.key[0] === d).length;
                              const active = picked.length === 0 || picked.includes(d);
                              const from = d + '0'.repeat(width - 1);
                              const to = d + '9'.repeat(width - 1);
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  disabled={count === 0}
                                  onClick={() => toggleDecade(d)}
                                  className={`tnum rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-30 ${
                                    active && count > 0
                                      ? 'border-accent/60 bg-accent/15 text-accent'
                                      : 'border-line bg-panel2 text-muted'
                                  }`}
                                >
                                  {from}–{to}
                                  <span className="ml-1 opacity-60">{count}</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                            <button type="button" className="hover:text-accent"
                              onClick={() => setDecades((c) => ({ ...c, [s.id]: [] }))}>
                              전체
                            </button>
                            <span>·</span>
                            <span>
                              {picked.length === 0
                                ? '열 묶음 모두 출제합니다'
                                : `${picked.length}묶음만 출제합니다`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Field>
            <div className="flex flex-col gap-3">
              <Field label="출제 방식">
                <select value={mode} onChange={(e) => setMode(e.target.value as PickMode)}>
                  {(Object.keys(MODE_LABEL) as PickMode[]).map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m]}</option>
                  ))}
                </select>
              </Field>
              <Field label="자극 형태">
                <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
                  <option value="key">숫자·키</option>
                  <option value="card">카드</option>
                  <option value="mix">섞기</option>
                </select>
              </Field>
              <Field label="문항 수">
                <input type="number" min={5} max={300} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </Field>
            </div>
          </div>
          {m3 && <div className="mt-4"><GoalPanel goal={m3} /></div>}

          <div className="mt-4 flex items-center gap-3">
            <Btn variant="primary" size="lg" disabled={namedCount === 0} onClick={start}>시작</Btn>
            <span className="text-xs text-muted">
              출제 가능한 이미지 {namedCount}개 · 이름을 치고 <kbd>Enter</kbd> ·{' '}
              빈칸에서 <kbd>Backspace</kbd> 앞 문제 · <kbd>Esc</kbd> 중단
            </span>
          </div>
          {namedCount === 0 && (
            <p className="mt-3 text-sm text-warn">
              이름이 채워진 이미지가 없습니다. <Link to="/assets/sets" className="text-accent underline">이미지 세트</Link>에서 먼저 채워 주십시오.
            </p>
          )}
        </Panel>
      </div>
    );
  }

  /* ───────── 결과 화면 ───────── */
  if (phase === 'done') {
    const done = results.filter((r) => r.verdict !== 'skip');
    const correct = done.filter((r) => r.verdict === 'correct');
    const rts = correct.map((r) => r.rtMs);
    return (
      <div className="flex flex-col gap-4">
        <Panel title="드릴 결과">
          {done.length === 0 ? (
            <Empty>기록된 문항이 없습니다.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Stat label="문항" value={done.length} />
                <Stat label="정확도" value={fmtPct(correct.length / done.length)} sub={`${correct.length}/${done.length}`} />
                <Stat label="총 걸린 시간" value={mmss(totalMs)} sub={`문항당 ${fmtMs(Math.round(totalMs / done.length))}`} />
                <Stat label="중앙 반응시간" value={fmtMs(median(rts))} />
                <Stat label="가장 느린" value={fmtMs(Math.max(0, ...rts))} />
                <Stat label="최고 연속" value={bestStreak} />
              </div>
              {m3 && <div className="mt-4"><GoalPanel goal={m3} celebrate /></div>}
              <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-line">
                {/* 좁은 화면에서는 이름칸이 짓눌리느니 가로로 밀리는 편이 낫다 */}
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="sticky top-0 bg-panel2 text-xs text-muted">
                    <tr>
                      <th className="w-16 px-2 py-1.5 text-left">자극</th>
                      <th className="px-2 py-1.5 text-left">이미지 <span className="font-normal text-muted/70">— 눌러서 고치실 수 있습니다</span></th>
                      <th className="w-20 px-2 py-1.5 text-right">반응</th>
                      <th className="w-12 px-2 py-1.5 text-center">판정</th>
                      <th className="px-2 py-1.5 text-left">치신 것</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const live = images.find((im) => im.id === r.trial.image.id) ?? r.trial.image;
                      const dom = sets.find((st) => st.id === live.setId)?.domain;
                      return (
                        <tr key={i} className="border-t border-line/60">
                          <td className="tnum px-2 py-1">{r.trial.display}</td>
                          <td className="px-2 py-1">
                            {settings && (
                              <NameCell
                                image={live}
                                map={settings.chosungMap}
                                isDigits={dom === 'digit2' || dom === 'digit3'}
                              />
                            )}
                          </td>
                          <td className="tnum px-2 py-1 text-right">{fmtMs(r.rtMs)}</td>
                          <td className={`px-2 py-1 text-center ${r.verdict === 'correct' ? 'text-good' : 'text-bad'}`}>
                            {r.verdict === 'correct' ? '○' : '×'}
                          </td>
                          <td className="px-2 py-1 text-xs text-muted">
                            {r.typedInput && (
                              <>
                                {r.typedInput}{' '}
                                <span className={r.typedMatch === 'none' || r.typedMatch === 'chosung' ? 'text-bad' : 'text-good'}>
                                  {MATCH_LABEL[r.typedMatch ?? 'none']}
                                </span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn variant="primary" onClick={() => setPhase('setup')}>다시 설정</Btn>
            <Btn onClick={start}>같은 조건으로 한 번 더</Btn>
            {results.length > 0 && (
              <Btn disabled={undoing} onClick={undo}>← 마지막 판정 고치기</Btn>
            )}
            <LinkBtn to="/stats">대시보드</LinkBtn>
          </div>
        </Panel>
      </div>
    );
  }

  /* ───────── 실행 화면 ───────── */
  const trial = queue[idx];
  if (!trial) return <Empty>출제할 문항이 없습니다.</Empty>;
  /* 틀려서 붙잡혀 있는 동안에는 방금 틀린 문제를 계속 보여 준다 */
  const last = phase === 'feedback' ? results[results.length - 1] : undefined;
  const shown = last?.trial ?? trial;

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
        className={`flex min-h-[22rem] flex-col items-center justify-center gap-6 rounded-xl border px-4 py-6 transition-colors ${
          flash === 'good' ? 'mg-good border-good/70 bg-good/10' :
          flash === 'bad' ? 'mg-bad border-bad/70 bg-bad/10' :
          'border-line bg-panel'
        }`}
        onClick={() => phase === 'asking' && typedRef.current?.focus()}
      >
        <div className="tnum text-[5.5rem] leading-none font-semibold tracking-wider">{shown.display}</div>

        {phase === 'asking' && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={typedRef}
                value={typedInput}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  /* 아무것도 안 친 상태의 Backspace 는 앞 문제로 (1·2단계와 같은 규칙) */
                  else if (e.key === 'Backspace' && !e.currentTarget.value) { e.preventDefault(); undo(); }
                }}
                className="w-56 text-center text-xl"
                placeholder="이미지 이름"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {/* 휴대폰에는 Enter 가 잘 안 보인다 */}
              <Btn variant="primary" onClick={submit} disabled={!typedInput.trim()}>확인</Btn>
            </div>
            <span className="text-xs text-muted">
              {imeHint ? '한/영 을 한글로 바꾸고 다시 쳐 주십시오' : '이름을 치고 Enter'}
            </span>
          </div>
        )}

        {phase === 'feedback' && last && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-sm text-bad">치신 것 — {last.typedInput || '—'}</div>
            <div className="text-4xl font-semibold text-good">{last.trial.image.name}</div>
            {last.trial.image.note && <div className="text-sm text-muted">{last.trial.image.note}</div>}
            {last.typedMatch === 'chosung' && (
              <div className="text-xs text-warn">초성은 맞았습니다 — 이름까지 떠올라야 합니다</div>
            )}
            <div className="tnum text-xs text-muted">{fmtMs(last.rtMs)}</div>
            <Btn variant="primary" onClick={continueAfterWrong}>계속 (Enter)</Btn>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        떠오른 이름을 그대로 치십시오. 초성만으로는 넘어가지 않습니다 — 그건 2단계입니다.
      </p>
    </div>
  );
}
