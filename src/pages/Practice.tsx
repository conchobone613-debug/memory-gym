import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import {
  db, ERROR_TAG_LABEL, getSettings, type ErrorTag, type Palace, type PracticeMode, type RecallCell,
} from '../db/db';
import { markRecallWrong } from '../db/record';
import { cardLabel, fullDeck, normalizeCardInput, resolveCard } from '../lib/cards';
import { randBelow, shuffle, uid } from '../lib/random';
import { isTyping } from '../App';
import { Btn, Empty, Field, LinkBtn, Panel, Stat, fmtPct } from '../components/ui';

type Phase = 'setup' | 'memorize' | 'recall' | 'grade' | 'done';

interface Preset {
  id: string; label: string; mode: PracticeMode; length: number; memorizeSec: number; recallSec: number; chunk: number;
}

const PRESETS: Preset[] = [
  { id: 'd80', label: '숫자 80자리 (5분 / 15분)', mode: 'digits', length: 80, memorizeSec: 300, recallSec: 900, chunk: 2 },
  { id: 'd40', label: '숫자 40자리 (2분 / 5분)', mode: 'digits', length: 40, memorizeSec: 120, recallSec: 300, chunk: 2 },
  { id: 'c52', label: '카드 52장 (5분 / 5분)', mode: 'cards', length: 52, memorizeSec: 300, recallSec: 300, chunk: 1 },
  { id: 'c20', label: '카드 20장 (2분 / 3분)', mode: 'cards', length: 20, memorizeSec: 120, recallSec: 180, chunk: 1 },
  /* 대회 지구력 종목. 대회는 '시간 안에 최대한 많이' 지만 여기서는 길이를 넉넉히 잡아 흉내만 낸다. */
  { id: 'h-num', label: '1시간 숫자 600자리 (60분 / 120분)', mode: 'digits', length: 600, memorizeSec: 3600, recallSec: 7200, chunk: 2 },
];

const TAGS: ErrorTag[] = ['image', 'locus', 'link', 'order'];

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function chunkify(items: string[], size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size).join(''));
  return out;
}

export default function Practice() {
  const palaces = useLiveQuery(() => db.palaces.toArray(), [], [] as Palace[]);
  const settings = useLiveQuery(() => getSettings(), []);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], []);

  const [params, setParams] = useSearchParams();
  const [presetId, setPresetId] = useState('d80');
  /** 'easy' 연습(시간 안 잼) · 'real' 실전(대회 규격) */
  const [runMode, setRunMode] = useState<'easy' | 'real'>('real');
  const [eventId, setEventId] = useState<string | undefined>();
  const [custom, setCustom] = useState(false);
  const [mode, setMode] = useState<PracticeMode>('digits');
  const [length, setLength] = useState(80);
  const [chunk, setChunk] = useState(2);
  const [memorizeSec, setMemorizeSec] = useState(300);
  const [recallSec, setRecallSec] = useState(900);
  const [unlimitedRecall, setUnlimitedRecall] = useState(false);
  const [palaceId, setPalaceId] = useState('');

  const loci = useLiveQuery(
    async () =>
      palaceId ? (await db.loci.where('palaceId').equals(palaceId).toArray()).sort((a, b) => a.order - b.order) : [],
    [palaceId],
    [],
  );

  const [phase, setPhase] = useState<Phase>('setup');
  const [stimulus, setStimulus] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [tags, setTags] = useState<Record<number, ErrorTag[]>>({});
  const [cursor, setCursor] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(0);
  const [memorizeUsedMs, setMemorizeUsedMs] = useState(0);
  const [recallUsedMs, setRecallUsedMs] = useState(0);
  const [sessionId, setSessionId] = useState('');

  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** 회상 칸은 비제어 입력이다. 제어 입력이면 React 리렌더를 기다리는 사이 빠른 타이핑이 유실된다. */
  const answersRef = useRef<string[]>([]);

  const preset = PRESETS.find((p) => p.id === presetId)!;

  /* 종목 화면에서 ?preset=... 으로 넘어오면 그 프리셋으로 맞춰 둔다 */
  useEffect(() => {
    const want = params.get('preset');
    const run = params.get('run');
    const ev = params.get('event');
    if (!want && !run && !ev) return;
    if (want && PRESETS.some((p) => p.id === want)) { setCustom(false); setPresetId(want); }
    if (run === 'easy' || run === 'real') setRunMode(run);
    if (ev) setEventId(ev);
    setParams({}, { replace: true });
  }, [params, setParams]);

  /* 연습은 시간을 재지 않고, 분량도 짧게 시작한다. 느린 실전이 아니라 보조를 켜는 자리다. */
  const easy = runMode === 'easy';

  useEffect(() => {
    if (custom) return;
    setMode(preset.mode);
    setLength(preset.length);
    setChunk(preset.chunk);
    setMemorizeSec(preset.memorizeSec);
    setRecallSec(preset.recallSec);
  }, [presetId, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 타이머 틱 */
  useEffect(() => {
    if (phase !== 'memorize' && phase !== 'recall') return;
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  const expected = useMemo(
    () => (mode === 'digits' ? chunkify(stimulus, chunk) : stimulus),
    [stimulus, chunk, mode],
  );

  const start = () => {
    const effChunk = mode === 'digits' ? chunk : 1;
    const wanted = easy ? Math.max(effChunk * 5, Math.round(length / 4)) : length;
    const n = mode === 'digits' ? Math.ceil(wanted / effChunk) * effChunk : Math.min(wanted, 52);
    const seq = mode === 'digits'
      ? Array.from({ length: n }, () => String(randBelow(10)))
      : shuffle(fullDeck()).slice(0, n);
    const blanks = Array.from({ length: mode === 'digits' ? n / effChunk : n }, () => '');
    setStimulus(seq);
    setAnswers(blanks);
    answersRef.current = [...blanks];
    cellRefs.current = [];
    setTags({});
    setCursor(0);
    setStartedAt(Date.now());
    setDeadline(easy ? Number.MAX_SAFE_INTEGER : Date.now() + memorizeSec * 1000);
    setPhase('memorize');
  };

  const recallStart = useRef(0);

  const toRecall = useCallback(() => {
    setMemorizeUsedMs(Date.now() - startedAt);
    recallStart.current = Date.now();
    setDeadline(easy ? Number.MAX_SAFE_INTEGER : Date.now() + recallSec * 1000);
    setPhase('recall');
    requestAnimationFrame(() => cellRefs.current[0]?.focus());
  }, [recallSec, startedAt]);

  const toGrade = useCallback(() => {
    if (recallStart.current) setRecallUsedMs(Date.now() - recallStart.current);
    setAnswers([...answersRef.current]);
    setPhase('grade');
    setCursor(0);
  }, []);

  /* 시간 만료 자동 전환 */
  useEffect(() => {
    if (easy) return; // 연습은 회장님이 끝낼 때까지 기다린다
    if (phase === 'memorize' && nowMs >= deadline) toRecall();
    if (phase === 'recall' && !unlimitedRecall && nowMs >= deadline) toGrade();
  }, [nowMs, deadline, phase, toRecall, toGrade, unlimitedRecall, easy]);

  const graded = useMemo(
    () =>
      expected.map((exp, i) => {
        const raw = answers[i] ?? '';
        const ans = mode === 'cards' ? (normalizeCardInput(raw) ?? raw.trim().toUpperCase()) : raw.trim();
        return { index: i, expected: exp, answered: ans, isCorrect: ans === exp, blank: ans === '' };
      }),
    [expected, answers, mode],
  );

  const score = useMemo(() => {
    const correct = graded.filter((g) => g.isCorrect).length;
    const blank = graded.filter((g) => g.blank).length;
    return { correct, blank, wrong: graded.length - correct - blank, total: graded.length };
  }, [graded]);

  const digitScore = useMemo(() => {
    if (mode !== 'digits') return null;
    let ok = 0;
    for (const g of graded) {
      for (let i = 0; i < g.expected.length; i++) if (g.answered[i] === g.expected[i]) ok++;
    }
    return { ok, total: stimulus.length };
  }, [graded, mode, stimulus.length]);

  const wrongCells = useMemo(() => graded.filter((g) => !g.isCorrect), [graded]);

  /** 채점 화면에서 '이 칸은 무슨 이미지였나' 를 보여 준다. 연습에서만 켠다. */
  const imageNameFor = (expectedKey: string): string | undefined => {
    if (!easy || !settings) return undefined;
    const bySetKey = new Map(images.map((i) => [`${i.setId}:${i.key}`, i]));
    const setByDomain = new Map(sets.map((x) => [x.domain, x]));
    if (mode === 'digits') {
      const set = setByDomain.get(chunk === 3 ? 'digit3' : 'digit2');
      return set ? bySetKey.get(`${set.id}:${expectedKey}`)?.name || undefined : undefined;
    }
    const r = resolveCard(expectedKey, settings.suitDigits, settings.rankDigits);
    const set = r && setByDomain.get(r.domain);
    return r && set ? bySetKey.get(`${set.id}:${r.key}`)?.name || undefined : undefined;
  };

  const save = async () => {
    const id = uid();
    const cells: RecallCell[] = graded.map((g) => ({
      id: uid(), sessionId: id, index: g.index, expected: g.expected, answered: g.answered,
      isCorrect: g.isCorrect,
      errorTags: g.isCorrect ? [] : [...(tags[g.index] ?? []), ...(g.blank ? (['blank'] as ErrorTag[]) : [])],
    }));
    await db.transaction('rw', db.recallSessions, db.recallCells, async () => {
      await db.recallSessions.add({
        id, mode, presetName: custom ? `커스텀 ${mode === 'digits' ? `${stimulus.length}자리` : `${stimulus.length}장`}` : preset.label,
        stimulus, palaceId: palaceId || undefined, eventId, runMode,
        memorizeMs: memorizeSec * 1000, memorizeUsedMs,
        recallMs: recallSec * 1000, recallUsedMs, startedAt, endedAt: Date.now(),
        correct: score.correct, wrong: score.wrong, blank: score.blank,
      });
      await db.recallCells.bulkAdd(cells);
    });

    /* 틀린 칸의 이미지를 통계에도 오답으로 반영 */
    if (settings) {
      const bySetKey = new Map(images.map((i) => [`${i.setId}:${i.key}`, i]));
      const setByDomain = new Map(sets.map((s) => [s.domain, s]));
      const digitSet = setByDomain.get(chunk === 3 ? 'digit3' : 'digit2');
      for (const g of wrongCells) {
        let img;
        if (mode === 'digits' && digitSet) img = bySetKey.get(`${digitSet.id}:${g.expected}`);
        else if (mode === 'cards') {
          const r = resolveCard(g.expected, settings.suitDigits, settings.rankDigits);
          const s = r && setByDomain.get(r.domain);
          if (r && s) img = bySetKey.get(`${s.id}:${r.key}`);
        }
        if (img?.name) await markRecallWrong(img.id, img.setId, Date.now());
      }
    }
    setSessionId(id);
    setPhase('done');
  };

  const toggleTag = (index: number, tag: ErrorTag) =>
    setTags((cur) => {
      const list = cur[index] ?? [];
      return { ...cur, [index]: list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag] };
    });

  /* 채점 화면 단축키: 1~4 원인 태그, 방향키 이동 */
  useEffect(() => {
    if (phase !== 'grade') return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TAGS.length) {
        e.preventDefault();
        const cell = wrongCells[cursor];
        if (cell) toggleTag(cell.index, TAGS[n - 1]);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        setCursor((c) => Math.min(wrongCells.length - 1, c + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, cursor, wrongCells]);

  /* 암기 화면 Enter = 조기 종료 */
  useEffect(() => {
    if (phase !== 'memorize') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); toRecall(); }
      if (e.key === 'Escape') { e.preventDefault(); setPhase('setup'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, toRecall]);

  const onCellInput = (i: number, el: HTMLInputElement) => {
    const v = mode === 'digits' ? el.value.replace(/\D/g, '').slice(0, chunk) : el.value.slice(0, 4);
    if (el.value !== v) el.value = v;
    answersRef.current[i] = v;
    const filled = mode === 'digits' ? v.length === chunk : !!normalizeCardInput(v);
    if (filled && i + 1 < answersRef.current.length) cellRefs.current[i + 1]?.focus();
  };

  const onCellKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const len = answersRef.current.length;
    if (e.key === 'Backspace' && !e.currentTarget.value && i > 0) { e.preventDefault(); cellRefs.current[i - 1]?.focus(); }
    else if (e.key === 'ArrowRight' && i + 1 < len) { e.preventDefault(); cellRefs.current[i + 1]?.focus(); }
    else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); cellRefs.current[i - 1]?.focus(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toGrade(); }
  };

  /* ───────── 설정 ───────── */
  if (phase === 'setup') {
    return (
      <Panel title={easy ? '연습' : '실전'}>
        <p className="mb-3 text-sm text-muted">
          {easy
            ? '시간을 재지 않습니다. 분량도 짧게 냅니다. 채점할 때 이미지 이름과 궁전 장소를 같이 보여 줍니다.'
            : '대회 규격으로 시간을 잽니다. 암기 시간이 끝나면 자동으로 회상으로 넘어갑니다.'}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="프리셋">
              <select
                value={custom ? 'custom' : presetId}
                onChange={(e) => {
                  if (e.target.value === 'custom') setCustom(true);
                  else { setCustom(false); setPresetId(e.target.value); }
                }}
              >
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">커스텀</option>
              </select>
            </Field>
            {custom && (
              <>
                <Field label="종목">
                  <select value={mode} onChange={(e) => setMode(e.target.value as PracticeMode)}>
                    <option value="digits">숫자</option>
                    <option value="cards">카드</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={mode === 'digits' ? '자릿수' : '장수 (최대 52)'}>
                    <input type="number" min={2} max={mode === 'digits' ? 1000 : 52} value={length}
                      onChange={(e) => setLength(Number(e.target.value))} />
                  </Field>
                  {mode === 'digits' && (
                    <Field label="한 칸에 묶을 자릿수">
                      <select value={chunk} onChange={(e) => setChunk(Number(e.target.value))}>
                        <option value={2}>2자리 (00–99)</option>
                        <option value={3}>3자리 (000–999)</option>
                      </select>
                    </Field>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="암기 시간 (초)">
                    <input type="number" min={10} value={memorizeSec} onChange={(e) => setMemorizeSec(Number(e.target.value))} />
                  </Field>
                  <Field label="회상 시간 (초)">
                    <input type="number" min={10} value={recallSec} disabled={unlimitedRecall}
                      onChange={(e) => setRecallSec(Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={unlimitedRecall} onChange={(e) => setUnlimitedRecall(e.target.checked)} />
              회상은 시간 제한 없이
            </label>
          </div>
          <div className="flex flex-col gap-3">
            <Field label="사용할 궁전 (선택)">
              <select value={palaceId} onChange={(e) => setPalaceId(e.target.value)}>
                <option value="">지정 안 함</option>
                {palaces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="rounded-lg border border-line bg-panel2 p-3 text-xs text-muted">
              <div className="mb-1 font-medium text-fg">이번 설정</div>
              {(() => {
                const shown = easy ? Math.max(chunk * 5, Math.round(length / 4)) : length;
                return mode === 'digits'
                  ? `숫자 ${Math.ceil(shown / chunk) * chunk}자리 · ${chunk}자리씩 ${Math.ceil(shown / chunk)}칸`
                  : `카드 ${Math.min(shown, 52)}장`;
              })()}
              <br />
              {easy
                ? '암기 무제한 · 회상 무제한'
                : `암기 ${mmss(memorizeSec * 1000)} · 회상 ${unlimitedRecall ? '무제한' : mmss(recallSec * 1000)}`}
            </div>
            <Btn variant="primary" size="lg" onClick={start}>시작</Btn>
            <p className="text-xs text-muted">
              암기 중 <kbd>Enter</kbd> 로 조기 종료 · 회상 중 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 로 제출
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  /* ───────── 암기 ───────── */
  if (phase === 'memorize') {
    const left = deadline - nowMs;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className={`tnum text-3xl font-semibold ${!easy && left < 30000 ? 'text-warn' : ''}`}>
            {easy ? mmss(nowMs - startedAt) : mmss(left)}
          </span>
          <div className="flex gap-2">
            <Btn variant="primary" onClick={toRecall}>외웠습니다 (Enter)</Btn>
            <Btn onClick={() => setPhase('setup')}>취소 (Esc)</Btn>
          </div>
        </div>
        <Panel>
          <div className="grid grid-cols-5 gap-x-3 gap-y-2 sm:grid-cols-10">
            {(mode === 'digits' ? chunkify(stimulus, chunk) : stimulus).map((c, i) => (
              <span
                key={i}
                className={`tnum text-center text-2xl sm:text-3xl ${
                  mode === 'cards' && 'HD'.includes(c[0]) ? 'text-bad' : ''
                }`}
              >
                {mode === 'cards' ? cardLabel(c) : c}
              </span>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  /* ───────── 회상 ───────── */
  if (phase === 'recall') {
    const left = deadline - nowMs;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className={`tnum text-3xl font-semibold ${!easy && !unlimitedRecall && left < 60000 ? 'text-warn' : ''}`}>
            {easy || unlimitedRecall ? mmss(nowMs - recallStart.current) : mmss(left)}
          </span>
          <Btn variant="primary" onClick={toGrade}>제출 (Ctrl+Enter)</Btn>
        </div>
        <Panel title={mode === 'cards' ? '카드 입력: s7 · ha(에이스) · dt 또는 d10 · ck' : '기억나는 만큼 채우십시오'}>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {answers.map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="tnum text-[10px] text-muted">{i + 1}</span>
                {loci[i] && (
                  <span className="w-full truncate text-center text-[10px] text-accent/80" title={loci[i].name}>
                    {loci[i].name}
                  </span>
                )}
                <input
                  ref={(el) => { cellRefs.current[i] = el; }}
                  defaultValue={answersRef.current[i]}
                  onInput={(e) => onCellInput(i, e.currentTarget)}
                  onKeyDown={(e) => onCellKey(i, e)}
                  className="tnum w-full px-1 py-1 text-center"
                  inputMode={mode === 'digits' ? 'numeric' : 'text'}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  /* ───────── 채점 + 원인 태그 ───────── */
  if (phase === 'grade') {
    return (
      <div className="flex flex-col gap-4">
        <Panel title="채점">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="칸 정답" value={`${score.correct}/${score.total}`} sub={fmtPct(score.total ? score.correct / score.total : 0)} />
            <Stat label="오답" value={score.wrong} />
            <Stat label="미기입" value={score.blank} />
            {digitScore && <Stat label="자릿수 정답" value={`${digitScore.ok}/${digitScore.total}`} />}
          </div>
          <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {graded.map((g) => (
              <div
                key={g.index}
                className={`rounded-md border px-1 py-1 text-center ${
                  g.isCorrect ? 'border-good/40 bg-good/10' : g.blank ? 'border-line bg-panel2' : 'border-bad/50 bg-bad/10'
                }`}
              >
                {loci[g.index] && (
                  <div className="truncate text-[10px] text-accent/80" title={loci[g.index].name}>
                    {loci[g.index].name}
                  </div>
                )}
                <div className="tnum text-sm">{mode === 'cards' ? cardLabel(g.expected) : g.expected}</div>
                {imageNameFor(g.expected) && (
                  <div className="truncate text-[10px] text-muted" title={imageNameFor(g.expected)}>
                    {imageNameFor(g.expected)}
                  </div>
                )}
                {!g.isCorrect && (
                  <div className="tnum text-[11px] text-bad">
                    {g.blank ? '—' : mode === 'cards' ? cardLabel(g.answered) : g.answered}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title={`오답 원인 태그 (${wrongCells.length}칸)`}
          right={<span className="text-[11px] text-muted">1 이미지혼동 · 2 장소 · 3 연결 · 4 순서 · ↑↓ 이동</span>}
        >
          {wrongCells.length === 0 ? (
            <Empty>틀린 칸이 없습니다.</Empty>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
              {wrongCells.map((g, i) => (
                <li
                  key={g.index}
                  onClick={() => setCursor(i)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-1.5 ${
                    i === cursor ? 'border-accent bg-accent/10' : 'border-line bg-panel2'
                  }`}
                >
                  <span className="tnum w-10 text-xs text-muted">#{g.index + 1}</span>
                  <span className="tnum w-24 text-sm">
                    {mode === 'cards' ? cardLabel(g.expected) : g.expected}
                    <span className="text-bad"> ← {g.blank ? '—' : mode === 'cards' ? cardLabel(g.answered) : g.answered}</span>
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {TAGS.map((t, ti) => (
                      <button
                        key={t}
                        onClick={(e) => { e.stopPropagation(); toggleTag(g.index, t); }}
                        className={`rounded-md border px-2 py-0.5 text-xs ${
                          (tags[g.index] ?? []).includes(t) ? 'border-accent bg-accent/20 text-accent' : 'border-line'
                        }`}
                      >
                        {ti + 1} {ERROR_TAG_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2">
            <Btn variant="primary" onClick={save}>기록 저장</Btn>
            <Btn onClick={() => setPhase('recall')}>회상으로 돌아가기</Btn>
          </div>
        </Panel>
      </div>
    );
  }

  /* ───────── 완료 ───────── */
  return (
    <Panel title="저장 완료">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="칸 정답" value={`${score.correct}/${score.total}`} />
        <Stat label="정확도" value={fmtPct(score.total ? score.correct / score.total : 0)} />
        {digitScore && <Stat label="자릿수 정답" value={`${digitScore.ok}/${digitScore.total}`} />}
        <Stat label="암기 사용" value={mmss(memorizeUsedMs)} sub={`제한 ${mmss(memorizeSec * 1000)}`} />
        <Stat label="회상 사용" value={mmss(recallUsedMs)} sub={`합계 ${mmss(memorizeUsedMs + recallUsedMs)}`} />
      </div>
      <p className="mt-3 text-xs text-muted">세션 {sessionId.slice(0, 8)} · 출제 수열과 칸별 기록이 모두 저장되었습니다.</p>
      <div className="mt-4 flex gap-2">
        <Btn variant="primary" onClick={() => setPhase('setup')}>다시</Btn>
        <LinkBtn to="/stats">대시보드</LinkBtn>
      </div>
    </Panel>
  );
}
