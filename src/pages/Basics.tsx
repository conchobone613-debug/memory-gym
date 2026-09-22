import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import {
  db, getSettings, type DrillAttempt, type ImageSet, type ImageStat, type MemoImage, type PickMode, type Verdict,
} from '../db/db';
import { recordAttempt, undoAttempt } from '../db/record';
import { buildQueue, median, rank } from '../lib/srs';
import { matchName, type MatchKind } from '../lib/hangul';
import { cardLabel, fullDeck, resolveCard } from '../lib/cards';
import { pickOne, randBelow, uid } from '../lib/random';
import { streaks } from '../lib/streak';
import MappingDrill from './MappingDrill';
import { type Stage } from '../lib/mapping';
import { goalFor } from '../db/goals';
import GoalPanel from '../components/GoalPanel';
import { isTyping } from '../App';
import { Btn, Empty, Field, LinkBtn, Panel, Stat, Streak, fmtMs, fmtPct } from '../components/ui';

type Phase = 'setup' | 'showing' | 'typing' | 'reveal' | 'done';

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
  const [typedRate, setTypedRate] = useState(0.1);

  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<Trial[]>([]);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [typedInput, setTypedInput] = useState('');
  const [typedMatch, setTypedMatch] = useState<MatchKind | undefined>();
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
    if (settings) { setTypedRate(settings.typedCheckRate); setCount(settings.drillCount); }
  }, [settings?.typedCheckRate, settings?.drillCount]); // eslint-disable-line react-hooks/exhaustive-deps

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
      itemCount: trials.length, typedCheckRate: typedRate,
    });
    setSessionId(id);
    setQueue(trials);
    setResults([]);
    setIdx(0);
    sessionStart.current = Date.now();
    setElapsed(0);
    setStreak(0);
    setBestStreak(0);
    setFlash(null);
    setPhase('showing');
  }, [cardsByImage, count, mode, pool, selected, stats, style, typedRate]);

  const finish = useCallback(async (final: Result[]) => {
    const now = Date.now();
    if (sessionId) await db.drillSessions.update(sessionId, { endedAt: now });
    setTotalMs(now - sessionStart.current);
    setResults(final);
    setPhase('done');
  }, [sessionId]);

  const commit = useCallback(
    async (verdict: Verdict) => {
      const trial = queue[idx];
      if (!trial) return;
      const attempt: DrillAttempt = {
        id: uid(), sessionId, order: idx,
        imageId: trial.image.id, setId: trial.image.setId, key: trial.image.key,
        stimulus: trial.stimulus, rtMs: rtRef.current, verdict,
        typedInput: typedInput || undefined, typedMatch, shownAt: Date.now(),
      };
      const prevStat = await recordAttempt(attempt);
      setFlash(verdict === 'correct' ? 'good' : 'bad');
      setTimeout(() => setFlash(null), 340);
      if (verdict === 'correct') {
        setStreak((v) => { const n = v + 1; setBestStreak((b) => Math.max(b, n)); return n; });
      } else if (verdict === 'wrong') {
        setStreak(0);
      }
      const next = [
        ...results,
        {
          trial, rtMs: rtRef.current, verdict,
          typedInput: typedInput || undefined, typedMatch,
          attemptId: attempt.id, prevStat,
        },
      ];
      setTypedInput('');
      setTypedMatch(undefined);
      if (idx + 1 >= queue.length) await finish(next);
      else { setResults(next); setIdx(idx + 1); setPhase('showing'); }
    },
    [finish, idx, queue, results, sessionId, typedInput, typedMatch],
  );

  /**
   * 한 문제 뒤로 — 판정을 잘못 눌렀을 때.
   *
   * 화면만 되돌리면 기록은 틀린 채로 남는다. 원시 기록과 통계까지 같이 되돌린다.
   * 누를 때마다 한 칸씩 뒤로 가므로 몇 문제 전으로도 돌아갈 수 있다.
   * 반응시간은 처음 것을 그대로 쓴다 — 다시 재는 것은 이미 답을 본 뒤라 의미가 없다.
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
      rtRef.current = last.rtMs;
      setTypedInput(last.typedInput ?? '');
      setTypedMatch(last.typedMatch);
      setFlash(null);
      setPhase('reveal');
    } finally {
      setUndoing(false);
    }
  }, [phase, results, sessionId, undoing]);

  const onSpace = useCallback(() => {
    rtRef.current = Math.round(performance.now() - t0.current);
    const ask = randBelow(1000) / 1000 < typedRate;
    setPhase(ask ? 'typing' : 'reveal');
    if (ask) requestAnimationFrame(() => typedRef.current?.focus());
  }, [typedRate]);

  useEffect(() => {
    if (phase === 'showing') t0.current = performance.now();
  }, [phase, idx]);

  useEffect(() => {
    if (phase === 'setup' || phase === 'done') return;
    const t = setInterval(() => setElapsed(Date.now() - sessionStart.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  /* 드릴 단축키 */
  useEffect(() => {
    if (phase === 'setup' || phase === 'done') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(results); return; }
      if (isTyping(e.target)) return;
      if (e.key === 'Backspace') { e.preventDefault(); undo(); return; }
      if (phase === 'showing' && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); onSpace(); }
      else if (phase === 'reveal') {
        /* 화면 왼쪽이 맞음, 오른쪽이 틀림. 키보드에서도 D 가 F 왼쪽이라 순서가 맞는다. */
        const k = e.key.toLowerCase();
        if (k === 'd') { e.preventDefault(); commit('correct'); }
        else if (k === 'f') { e.preventDefault(); commit('wrong'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, finish, onSpace, phase, results, undo]);

  const submitTyped = () => {
    const trial = queue[idx];
    if (!trial || !settings) return;
    const set = sets.find((s) => s.id === trial.image.setId);
    const m = matchName(typedInput, trial.image, settings.chosungMap, set?.domain !== 'cardFace');
    setTypedMatch(m);
    setPhase('reveal');
  };

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
              <div className="grid grid-cols-2 gap-3">
                <Field label="문항 수">
                  <input type="number" min={5} max={300} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </Field>
                <Field label="타이핑 검증 확률">
                  <input
                    type="number" min={0} max={1} step={0.05}
                    value={typedRate}
                    onChange={(e) => setTypedRate(Number(e.target.value))}
                  />
                </Field>
              </div>
            </div>
          </div>
          {m3 && <div className="mt-4"><GoalPanel goal={m3} /></div>}

          <div className="mt-4 flex items-center gap-3">
            <Btn variant="primary" size="lg" disabled={namedCount === 0} onClick={start}>시작</Btn>
            <span className="text-xs text-muted">
              출제 가능한 이미지 {namedCount}개 · <kbd>Space</kbd> 떠올림 · <kbd>D</kbd> 맞음 · <kbd>F</kbd> 틀림 ·{' '}
              <kbd>Backspace</kbd> 앞 문제 · <kbd>Esc</kbd> 중단
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
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel2 text-xs text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">자극</th>
                      <th className="px-2 py-1.5 text-left">이미지</th>
                      <th className="px-2 py-1.5 text-right">반응</th>
                      <th className="px-2 py-1.5 text-center">판정</th>
                      <th className="px-2 py-1.5 text-left">타이핑</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="tnum px-2 py-1">{r.trial.display}</td>
                        <td className="px-2 py-1">{r.trial.image.name}</td>
                        <td className="tnum px-2 py-1 text-right">{fmtMs(r.rtMs)}</td>
                        <td className={`px-2 py-1 text-center ${r.verdict === 'correct' ? 'text-good' : 'text-bad'}`}>
                          {r.verdict === 'correct' ? '○' : r.verdict === 'wrong' ? '×' : '–'}
                        </td>
                        <td className="px-2 py-1 text-xs text-muted">
                          {r.typedInput ? `${r.typedInput} (${r.typedMatch})` : ''}
                        </td>
                      </tr>
                    ))}
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
        className={`flex min-h-[22rem] cursor-pointer flex-col items-center justify-center gap-6 rounded-xl border px-4 py-6 transition-colors select-none ${
          flash === 'good' ? 'mg-good border-good/70 bg-good/10' :
          flash === 'bad' ? 'mg-bad border-bad/70 bg-bad/10' :
          'border-line bg-panel'
        }`}
        onClick={() => phase === 'showing' && onSpace()}
      >
        <div className="tnum text-[5.5rem] leading-none font-semibold tracking-wider">{trial.display}</div>

        {phase === 'showing' && (
          <p className="text-sm text-muted">이미지가 떠오르면 <kbd>Space</kbd></p>
        )}

        {phase === 'typing' && (
          <div className="flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-muted">타이핑 검증 — 이미지 이름을 입력하십시오</span>
            <input
              ref={typedRef}
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } }}
              className="w-56 text-center text-lg"
              placeholder="이름 + Enter"
            />
          </div>
        )}

        {phase === 'reveal' && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-3xl font-semibold text-accent">{trial.image.name}</div>
            {trial.image.note && <div className="text-sm text-muted">{trial.image.note}</div>}
            {typedMatch && (
              <div className={`text-sm ${typedMatch === 'none' ? 'text-bad' : 'text-good'}`}>
                타이핑 「{typedInput || '—'}」 →{' '}
                {typedMatch === 'none' ? '불일치' : typedMatch === 'chosung' ? '초성 일치' : typedMatch === 'alias' ? '별칭 일치' : '정확 일치'}
              </div>
            )}
            <div className="tnum text-xs text-muted">{fmtMs(rtRef.current)}</div>
            <div className="grid w-full max-w-sm grid-cols-2 gap-2">
              <Btn variant="good" size="lg" className="min-h-14" onClick={(e) => { e.stopPropagation(); commit('correct'); }}>
                맞음 <span className="text-xs opacity-70">D</span>
              </Btn>
              <Btn variant="danger" size="lg" className="min-h-14" onClick={(e) => { e.stopPropagation(); commit('wrong'); }}>
                틀림 <span className="text-xs opacity-70">F</span>
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
