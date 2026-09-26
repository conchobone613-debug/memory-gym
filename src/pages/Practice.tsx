import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import {
  db, ERROR_TAG_LABEL, getSettings, saveSettings,
  type AppSettings, type ErrorTag, type Palace, type PracticeMode, type RecallCell, type RecallSession, type RuleValues,
} from '../db/db';
import { markRecallWrong } from '../db/record';
import { MEMORY_EVENTS } from '../data/events';
import { PRESETS } from '../data/presets';
import { cardLabel, fullDeck, normalizeCardInput } from '../lib/cards';
import { resolveCellImage } from '../lib/resolveImage';
import { randBelow, shuffle, uid } from '../lib/random';
import { compareBest, flapClock, NEAR_MISS, type RunOutcome } from '../lib/outcome';
import {
  BINARY_CELL, BINARY_ROW, binaryRowScore, bitsToKey, cellRows, CODE_LABEL, DEFAULT_BINARY_CODE, joinCells, randomBits, splitBits,
  type BinaryCode, type RowScore,
} from '../lib/binary';
import { createReader, DEFAULT_SPOKEN_LANG, DIGIT_WORDS, firstErrorScore, readingMs, type SpokenLang } from '../lib/spoken';
import { pickVoice, speakWord, speechSupported, stopSpeech, unlockSpeech } from '../lib/speech';
import { scoredHistory, scoredOutcome } from '../lib/eventOutcome';
import { isTyping } from '../App';
import { Empty, Field, Panel, Stat, fmtPct } from '../components/ui';
import { Countdown, Folder, Hud, Key, KeyLink, ResultSheet, useFocusMode, useFullscreen } from '../components/lp';
import CourseBar from '../components/CourseBar';
import SpokenListen from '../components/SpokenListen';
import BinaryPad from '../components/BinaryPad';
import { useCoachReview } from '../components/CoachReview';
import { courseStep } from '../coach';

/*
 * 종목 실행기 — 숫자·카드·듣고 외우는 숫자·이진수 암기 → 회상 → 채점(원인 태그) → 성적표.
 * 연습(run=easy)은 시간을 재지 않고 보조를 켜는 자리, 모의 대회(run=real)는 대회 규격 시간.
 * 모의 대회는 시작을 누르는 순간 전체 화면 → 3-2-1 → 암기. 판정 연출·계수기는 두지 않는다(측정 화면은 비운다).
 * 듣기는 암기 대신 낭독(SpokenListen)이고, 듣기·이진수는 대회식 점수(RecallSession.score)를 함께 남긴다.
 */

type Phase = 'setup' | 'countdown' | 'memorize' | 'recall' | 'grade' | 'done';

/** 종목 모양 — 보고 외우는 숫자·카드 · 듣고 외우는 숫자 · 이진수 */
type Style = 'plain' | 'spoken' | 'binary';

/** 한 판 동안 바뀌지 않는 조건 — 시작할 때 굳힌다(저장하는 params 가 여기서 나온다) */
interface RunCfg {
  style: Style;
  eventId: string;
  /** 듣기 낭독 간격 */
  intervalMs: number;
  lang: SpokenLang;
  code: BinaryCode;
  /** 이진수 연습 — 외우는 동안 바꾼 숫자 보이기 */
  showKeys: boolean;
}

/** 듣기 연습의 낭독 간격 */
const GAPS = [1000, 1500, 2000];
const LANG_NAME: Record<SpokenLang, string> = { ko: '한국어', en: '영어' };
const HIDDEN_NOTICE = '화면을 떠나 낭독을 멈췄습니다. 처음부터 다시 하십시오.';

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

/** 머리띠 오른쪽 시계. 모의 대회 막바지에만 빨강 — 측정 화면의 강조는 이 한 곳이다. */
function Clock({ ms, warn }: { ms: number; warn: boolean }) {
  return <span className={`tnum text-[26px] font-bold leading-none ${warn ? 'text-red' : 'text-ink'}`}>{mmss(ms)}</span>;
}

/**
 * 한 판의 성적표. 신기록·아까움은 실제 기록으로만 — 같은 프리셋·같은 모드·같은 칸 수의 지난 기록(이번 제외) 중
 * 맞힌 칸 최대와 비교한다. 첫 기록이면 신기록이 아니다(compareBest). 이 종목에는 아직 목표가 없어 별·도장도 없다.
 */
function recallOutcome({ correct, total, memorizeUsedMs, recallUsedMs, past }: {
  correct: number; total: number; memorizeUsedMs: number; recallUsedMs: number;
  /** 최근 것이 앞 */
  past: RecallSession[];
}): RunOutcome {
  const cmp = compareBest(past.map((s) => s.correct), correct, 'higher');
  const record = cmp.isRecord ? { what: `맞힌 칸 ${correct}칸` } : null;
  const nearGap = !record && cmp.gap > 0 && cmp.gap <= NEAR_MISS.items ? cmp.gap : 0;
  const last = past[0];
  return {
    stats: [
      { label: '정확도', value: String(Math.round((total ? correct / total : 0) * 100)), unit: '%' },
      { label: '맞힌 칸', value: String(correct), unit: `/${total}`, up: last && correct > last.correct ? `▲${correct - last.correct}` : undefined },
      { label: '암기 사용', value: flapClock(memorizeUsedMs) },
      { label: '회상 사용', value: flapClock(recallUsedMs) },
    ],
    goals: [],
    record,
    near: nearGap ? [{ lead: '신기록까지', value: `${nearGap}칸` }] : [],
    sage: recallSage(correct, total, !!record, nearGap),
  };
}

/** 스승님 한마디(규칙 코치) — 노교수 하게체. 숫자는 이 판의 실제 값만. */
function recallSage(correct: number, total: number, record: boolean, nearGap: number): string {
  if (!correct) return `${total}칸 중 한 칸도 맞히지 못했군. 분량을 줄여 다시 해 보세.`;
  if (record) return `${total}칸 중 ${correct}칸, 지금까지 가장 많이 맞혔네. 칠판 맨 위에 적어 두겠네.`;
  if (nearGap) return `신기록까지 ${nearGap}칸이었네. 손이 풀린 지금 한 판 더 하게.`;
  if (correct === total) return `${total}칸을 모두 맞혔네. 다음엔 분량을 늘려 보세.`;
  return `${total}칸 중 ${correct}칸일세. 틀린 ${total - correct}칸의 원인부터 다시 보게.`;
}

export default function Practice() {
  const palaces = useLiveQuery(() => db.palaces.toArray(), [], [] as Palace[]);
  const settings = useLiveQuery(() => getSettings(), []);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], []);
  const fs = useFullscreen();

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
  /* 듣기 — 연습 낭독 간격(보조), 커스텀 낭독 간격(초) · 이진수 — 연습에서 바꾼 숫자 보이기 */
  const [practiceGap, setPracticeGap] = useState(1500);
  const [customGapSec, setCustomGapSec] = useState(1);
  const [showKeys, setShowKeys] = useState(true);
  const [voiceNote, setVoiceNote] = useState('');
  /** 설정 화면 한 줄 안내(듣기 도중 화면을 떠나 멈춘 판) */
  const [notice, setNotice] = useState('');
  const [speechOk] = useState(speechSupported);
  /* 휴대폰(손가락)이면 이진수 회상에 화면 자판을 띄운다 */
  const [coarse] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const [run, setRun] = useState<RunCfg>({
    style: 'plain', eventId: 'speed-numbers', intervalMs: 0, lang: DEFAULT_SPOKEN_LANG, code: DEFAULT_BINARY_CODE, showKeys: false,
  });

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
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** 회상 칸은 비제어 입력이다. 제어 입력이면 React 리렌더를 기다리는 사이 빠른 타이핑이 유실된다. */
  const answersRef = useRef<string[]>([]);
  /** 화면 자판(이진수)이 넣을 칸 — 칸에 포커스가 올 때 기억한다 */
  const padCell = useRef(0);
  /** '기록 저장' 을 두 번 눌러도 한 번만 저장한다 */
  const saving = useRef(false);
  /** 소리 시험 — 판 번호가 바뀌면(시작·다시 시험·화면 떠남) 목소리를 고르던 시험은 읽지 않는다 */
  const testReader = useRef<{ stop(): void } | null>(null);
  const testNo = useRef(0);

  const preset = PRESETS.find((p) => p.id === presetId)!;
  /* 코스 진행 표시 — 아래에서 주소를 비우므로 처음 값을 붙들어 둔다 */
  const [course, setCourse] = useState(() => courseStep(params));
  /* 스승님 복기 — 성적표가 나온 판에서만 */
  const coach = useCoachReview('recall', phase === 'done' && outcome ? sessionId : '');

  /*
   * 종목 화면에서 ?preset=... 으로 넘어오면 그 프리셋으로 맞춰 둔다.
   * 이 화면은 주소만 바뀌면 새로 열리지 않으므로(App 은 경로로만 가른다) 코스의 다음 종목으로 넘어왔을 때
   * 앞 판의 성적표가 남아 있으면 설정 화면으로 되돌린다(Basics·MappingDrill 과 같다).
   */
  useEffect(() => {
    const want = params.get('preset');
    const run = params.get('run');
    const ev = params.get('event');
    if (!want && !run && !ev) return;
    if (want && PRESETS.some((p) => p.id === want)) { setCustom(false); setPresetId(want); }
    /* 그 종목에 없는 프리셋을 가리키면(또는 프리셋이 없으면) 그 종목의 첫 프리셋으로 */
    const own = ev ? PRESETS.filter((p) => p.eventId === ev) : [];
    if (own.length && !own.some((p) => p.id === want)) { setCustom(false); setPresetId(own[0].id); }
    if (run === 'easy' || run === 'real') setRunMode(run);
    if (ev) setEventId(ev);
    setCourse(courseStep(params));
    setPhase((p) => (p === 'done' ? 'setup' : p));
    setParams({}, { replace: true });
  }, [params, setParams]);

  /* 연습은 시간을 재지 않고, 분량도 짧게 시작한다. 느린 실전이 아니라 보조를 켜는 자리다. */
  const easy = runMode === 'easy';

  /*
   * 이 판의 종목 — 주소의 종목, 없으면 고른 프리셋의 종목. 커스텀은 듣기·이진수면 그 종목, 아니면 모양으로.
   * 종목 모양(style)은 프리셋을 고른 판이면 프리셋이 정한다 — 주소와 프리셋이 어긋나도 칸 모양과 채점이 한 모양이게.
   */
  const baseEv = custom ? (eventId ?? preset.eventId) : preset.eventId;
  const style: Style = baseEv === 'spoken-numbers' ? 'spoken' : baseEv === 'binary' ? 'binary' : 'plain';
  /* 기존 종목 주소로 연 커스텀에서 모양(숫자/카드)을 바꾸면 주소 종목이 아니라 모양에 맞는 종목으로 남긴다 */
  const urlMode = PRESETS.find((p) => p.eventId === eventId)?.mode;
  const byMode = mode === 'cards' ? 'speed-cards' : 'speed-numbers';
  const runEvent = custom && style === 'plain' && urlMode && urlMode !== mode
    ? byMode
    : eventId ?? (!custom || style !== 'plain' ? preset.eventId : byMode);
  /** 주소에 종목이 있으면 그 종목의 프리셋만 */
  const presetList = eventId && PRESETS.some((p) => p.eventId === eventId) ? PRESETS.filter((p) => p.eventId === eventId) : PRESETS;
  const lang: SpokenLang = settings?.spokenLang ?? DEFAULT_SPOKEN_LANG;
  const code: BinaryCode = settings?.binaryCode ?? DEFAULT_BINARY_CODE;
  /** 낭독 간격 — 커스텀은 입력값(0.5~3초), 연습은 고른 간격, 모의 대회는 프리셋 간격 */
  const gapMs = custom
    ? Math.round(Math.min(3, Math.max(0.5, customGapSec || 1)) * 1000)
    : easy ? practiceGap : (preset.spoken?.intervalMs ?? 1000);
  const planMode: PracticeMode = style === 'binary' ? 'binary' : style === 'spoken' ? 'digits' : mode;
  /** 이번 판에 낼 수(자리·장) — 연습은 4분의 1(최소 다섯 칸), 칸 크기의 배수로 올린다 */
  const planEffChunk = planMode === 'digits' ? chunk : planMode === 'binary' ? BINARY_CELL : 1;
  const planWanted = easy ? Math.max(planEffChunk * 5, Math.round(length / 4)) : length;
  const planN = planMode === 'cards' ? Math.min(planWanted, 52) : Math.ceil(planWanted / planEffChunk) * planEffChunk;

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

  /* 모의 대회를 마치거나(성적표) 도중에 그만두면(설정) 전체 화면을 푼다 */
  useEffect(() => {
    if (phase === 'setup' || phase === 'done') fs.exit();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 모의 대회의 카운트다운·암기·회상 동안에는 앱 머리말과 아래 탭도 내린다(방해 요소 없는 화면) */
  useFocusMode(!easy && (phase === 'countdown' || phase === 'memorize' || phase === 'recall'));

  const expected = useMemo(
    () => (mode === 'digits' ? chunkify(stimulus, chunk) : mode === 'binary' ? chunkify(stimulus, BINARY_CELL) : stimulus),
    [stimulus, chunk, mode],
  );

  const start = () => {
    const n = planN;
    const seq = planMode === 'digits'
      ? Array.from({ length: n }, () => String(randBelow(10)))
      : planMode === 'binary' ? randomBits(n)
      : shuffle(fullDeck()).slice(0, n);
    const blanks = Array.from({ length: planMode === 'cards' ? n : n / planEffChunk }, () => '');
    setMode(planMode);
    setRun({ style, eventId: runEvent, intervalMs: style === 'spoken' ? gapMs : 0, lang, code, showKeys: easy && showKeys });
    setStimulus(seq);
    setAnswers(blanks);
    answersRef.current = [...blanks];
    cellRefs.current = [];
    setTags({});
    setCursor(0);
    setStartedAt(Date.now());
    /* 듣기는 낭독이 끝나야 회상으로 간다(시간 만료 전환 없음) */
    setDeadline(easy || style === 'spoken' ? Number.MAX_SAFE_INTEGER : Date.now() + memorizeSec * 1000);
    setPhase('memorize');
  };

  const stopTest = () => {
    testNo.current++;
    testReader.current?.stop();
    testReader.current = null;
  };

  /* 화면을 떠나면 소리 시험도 멈춘다 */
  useEffect(() => {
    const no = testNo;
    const reader = testReader;
    return () => {
      no.current++;
      if (reader.current) { reader.current.stop(); stopSpeech(); }
    };
  }, []);

  /** 소리 시험 — '일 이 삼'(또는 one two three)을 1초 간격으로 읽고 쓰는 목소리를 적는다. 누름 처리기에서 부른다. */
  const testVoice = () => {
    if (!speechOk) return;
    stopTest();
    unlockSpeech();
    const no = testNo.current;
    const l = lang;
    pickVoice(l).then((voice) => {
      if (no !== testNo.current) return;
      setVoiceNote(voice ? `목소리: ${voice.name}` : `이 기기에 ${LANG_NAME[l]} 목소리가 없어 기본 목소리로 읽습니다`);
      const r = createReader({
        words: DIGIT_WORDS[l].slice(1, 4), intervalMs: 1000, leadMs: 0,
        speak: (w) => speakWord(w, voice, l),
        now: () => performance.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id as number),
        onEnd: () => {},
      });
      testReader.current = r;
      r.start();
    });
  };

  /**
   * 시작 · 한 판 더. 모의 대회는 전체 화면을 켠 뒤 3-2-1 을 거쳐 암기로 간다.
   * 전체 화면은 사용자 동작(누름·키) 안에서만 켜지므로 이 함수는 누름 처리기에서 바로 부른다.
   * 듣기는 여기서 음성을 먼저 연다 — 아이폰 사파리는 사용자 동작 안의 첫 발화가 있어야 뒤 발화가 난다.
   */
  const begin = () => {
    setNotice('');
    stopTest();
    if (style === 'spoken') {
      if (!speechOk) return;
      unlockSpeech();
    }
    if (easy) { start(); return; }
    fs.enter();
    setPhase('countdown');
  };

  const recallStart = useRef(0);
  /** 암기 → 회상으로 막 넘어왔을 때만 첫 칸에 커서를 둔다(채점에서 돌아올 때는 두지 않는다) */
  const focusFirst = useRef(false);

  /** usedMs = 듣기의 실제 낭독 시간. 없으면 암기를 시작한 때부터 지금까지 */
  const toRecall = useCallback((usedMs?: number) => {
    setMemorizeUsedMs(usedMs ?? Date.now() - startedAt);
    recallStart.current = Date.now();
    setDeadline(easy ? Number.MAX_SAFE_INTEGER : Date.now() + recallSec * 1000);
    focusFirst.current = true;
    setPhase('recall');
  }, [recallSec, startedAt, easy]);

  /** 듣기 취소 — 탭이 숨어 멈춘 판은 무효라 그 까닭을 설정 화면에 적는다 */
  const cancelListen = useCallback((reason?: 'hidden') => {
    if (reason === 'hidden') setNotice(HIDDEN_NOTICE);
    setPhase('setup');
  }, []);

  /* requestAnimationFrame 을 쓰지 않는다 — 창이 그리지 않는 동안에는 콜백이 오지 않아 커서가 안 잡히고,
     그러면 아무리 쳐도 글자가 안 들어간다. 칸이 그려진 직후(effect) 바로 focus 한다. */
  useEffect(() => {
    if (phase !== 'recall' || !focusFirst.current) return;
    focusFirst.current = false;
    cellRefs.current[0]?.focus();
  }, [phase]);

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
    if (mode === 'cards') return null;
    let ok = 0;
    for (const g of graded) {
      for (let i = 0; i < g.expected.length; i++) if (g.answered[i] === g.expected[i]) ok++;
    }
    return { ok, total: stimulus.length };
  }, [graded, mode, stimulus.length]);

  const wrongCells = useMemo(() => graded.filter((g) => !g.isCorrect), [graded]);

  /** 대회식 점수 — 듣기는 처음 틀린 곳까지 맞힌 자리 수, 이진수는 줄 점수(줄마다 점수도). 기존 종목은 없다. */
  const contest = useMemo((): { score: number; max: number; rows: RowScore[] } | null => {
    const exp = stimulus.join('');
    if (run.style === 'spoken') return { score: firstErrorScore(exp, joinCells(answers, chunk)), max: exp.length, rows: [] };
    if (run.style === 'binary') return binaryRowScore(exp, joinCells(answers, BINARY_CELL), BINARY_ROW);
    return null;
  }, [run.style, stimulus, answers, chunk]);

  /** 칸 하나를 화면 글자로: 카드는 무늬 기호, 숫자는 그대로 */
  const show = (key: string) => (mode === 'cards' ? cardLabel(key) : key);

  /** 이미지 찾기용 설정 — 이진수는 그 판에 굳힌 변환 방식으로 */
  const cellSettings = (s: AppSettings): AppSettings => (mode === 'binary' ? { ...s, binaryCode: run.code } : s);

  /** 채점 화면에서 '이 칸은 무슨 이미지였나' 를 보여 준다. 연습에서만 켠다. */
  const imageNameFor = (expectedKey: string): string | undefined => {
    if (!easy || !settings) return undefined;
    return resolveCellImage(expectedKey, mode, chunk, cellSettings(settings), sets, images)?.name || undefined;
  };

  const save = async () => {
    /* 저장이 끝나기 전에 또 누르면 같은 판이 두 번 기록된다 */
    if (saving.current) return;
    saving.current = true;
    try {
      await saveRun();
    } finally {
      saving.current = false;
    }
  };

  const saveRun = async () => {
    const id = uid();
    const n = stimulus.length;
    const presetName = !custom ? preset.label
      : run.style === 'spoken' ? `커스텀 듣기 ${n}자리`
      : run.style === 'binary' ? `커스텀 이진수 ${n}자리`
      : `커스텀 ${mode === 'digits' ? `${n}자리` : `${n}장`}`;
    /* 그 판 조건 사본 — 설정을 나중에 바꿔도 옛 판의 뜻이 남는다. 기존 종목은 비워 둔다 */
    const extra: { score?: number; params?: RuleValues } = run.style === 'spoken'
      ? { score: contest?.score, params: { intervalMs: run.intervalMs, lang: run.lang } }
      : run.style === 'binary' ? { score: contest?.score, params: { code: run.code, rowLen: BINARY_ROW } } : {};
    /* 듣기의 암기 시간은 낭독 시간(자리 수 × 간격) */
    const memorizeMs = run.style === 'spoken' ? n * run.intervalMs : memorizeSec * 1000;
    const cells: RecallCell[] = graded.map((g) => ({
      id: uid(), sessionId: id, index: g.index, expected: g.expected, answered: g.answered,
      isCorrect: g.isCorrect,
      errorTags: g.isCorrect ? [] : [...(tags[g.index] ?? []), ...(g.blank ? (['blank'] as ErrorTag[]) : [])],
    }));
    await db.transaction('rw', db.recallSessions, db.recallCells, async () => {
      await db.recallSessions.add({
        id, mode, presetName,
        stimulus, palaceId: palaceId || undefined, eventId: run.eventId, runMode,
        memorizeMs, memorizeUsedMs,
        recallMs: recallSec * 1000, recallUsedMs, startedAt, endedAt: Date.now(),
        correct: score.correct, wrong: score.wrong, blank: score.blank,
        ...extra,
      });
      await db.recallCells.bulkAdd(cells);
    });

    /* 틀린 칸의 이미지를 통계에도 오답으로 반영 */
    if (settings) {
      for (const g of wrongCells) {
        const img = resolveCellImage(g.expected, mode, chunk, cellSettings(settings), sets, images);
        if (img?.name) await markRecallWrong(img.id, img.setId, Date.now());
      }
    }

    /* 성적표 — 비교는 같은 프리셋·같은 모드·같은 칸 수의 지난 기록만(runMode 가 없는 옛 기록은 규격대로 한 판) */
    const sameMode = await db.recallSessions.where('mode').equals(mode).toArray();
    if (contest) {
      /* 듣기·이진수는 대회 점수로 — 듣기는 같은 낭독 간격의 판만 */
      const past = scoredHistory(sameMode, {
        id, presetName, runMode, total: score.total, intervalMs: run.style === 'spoken' ? run.intervalMs : undefined,
      });
      setOutcome(scoredOutcome({
        kind: run.style === 'spoken' ? 'spoken' : 'binary', score: contest.score, max: contest.max,
        correct: score.correct, total: score.total, memorizeUsedMs, recallUsedMs, past,
      }));
    } else {
      const past = sameMode
        .filter((s) => s.id !== id && s.presetName === presetName && (s.runMode ?? 'real') === runMode
          && s.correct + s.wrong + s.blank === score.total)
        .sort((a, b) => b.startedAt - a.startedAt);
      setOutcome(recallOutcome({ correct: score.correct, total: score.total, memorizeUsedMs, recallUsedMs, past }));
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

  /* 암기 화면 Enter = 조기 종료(듣기는 없음 — 낭독이 끝나야 회상), Esc = 취소 */
  const listening = run.style === 'spoken';
  useEffect(() => {
    if (phase !== 'memorize') return;
    const onKey = (e: KeyboardEvent) => {
      // 성적표에서 Enter(한 판 더)로 새 판이 열리면 같은 키가 여기까지 온다 — 이미 처리된 키는 받지 않는다
      if (e.defaultPrevented) return;
      if (e.key === 'Enter' && !listening) { e.preventDefault(); toRecall(); }
      if (e.key === 'Escape') { e.preventDefault(); setPhase('setup'); }
    };
    // 모의 대회 전체 화면에서는 브라우저가 첫 Esc 를 '전체 화면 나가기'로 가져가 keydown 이 오지 않는다 → 풀리면 취소로 본다
    const onFs = () => { if (!document.fullscreenElement) setPhase('setup'); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [phase, toRecall, listening]);

  const onCellInput = (i: number, el: HTMLInputElement) => {
    const v = mode === 'digits' ? el.value.replace(/\D/g, '').slice(0, chunk)
      : mode === 'binary' ? el.value.replace(/[^01]/g, '').slice(0, BINARY_CELL)
      : el.value.slice(0, 4);
    if (el.value !== v) el.value = v;
    answersRef.current[i] = v;
    const filled = mode === 'digits' ? v.length === chunk : mode === 'binary' ? v.length === BINARY_CELL : !!normalizeCardInput(v);
    if (filled && i + 1 < answersRef.current.length) cellRefs.current[i + 1]?.focus();
  };

  /**
   * 휴대폰 이진수 자판 — 기억해 둔 칸에 넣고/지운 뒤 키보드 입력과 같은 길(onCellInput)을 탄다.
   * 누른 뒤 그 칸에 다시 포커스를 준다(다 차면 onCellInput 이 다음 칸으로). 지우기는 앞 칸으로 넘기지 않는다.
   */
  const padInput = (ch: '0' | '1' | null) => {
    const i = padCell.current;
    const el = cellRefs.current[i];
    if (!el) return;
    el.value = ch == null ? el.value.slice(0, -1) : el.value + ch;
    el.focus();
    onCellInput(i, el);
  };

  /** 자판이 칸을 가리지 않게 — 포커스가 온 칸을 자판 위(scroll-margin)까지 보이게 한다 */
  const onPadFocus = (i: number, el: HTMLInputElement) => {
    padCell.current = i;
    el.scrollIntoView({ block: 'nearest' });
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
    const evName = MEMORY_EVENTS.find((e) => e.id === (eventId ?? (style !== 'plain' ? runEvent : undefined)))?.name;
    const recallText = easy || unlimitedRecall ? '무제한' : mmss(recallSec * 1000);
    const blocked = style === 'spoken' && !speechOk;
    return (
      <div className="flex flex-col gap-1">
        {course && <div className="mb-2"><CourseBar step={course} /></div>}
        <h1 className="m-0 text-[30px] leading-tight text-ink">{easy ? '연습' : '모의 대회'}</h1>
        <p className="m-0 font-typek text-xs text-ink-2">
          {evName && `${evName} · `}
          {style === 'spoken'
            ? (easy ? '낭독을 늦추고 분량을 4분의 1로 줄입니다' : '한 번만 읽습니다 · 시작하면 전체 화면')
            : easy ? '시간을 재지 않고 분량을 4분의 1로 줄입니다' : '대회 규격 시간으로 잽니다 · 시작하면 전체 화면'}
        </p>
        {notice && (
          <p className="m-0 mt-2 rounded-[4px] border border-dashed border-ink-2 bg-card px-3 py-2 font-typek text-xs text-ink">{notice}</p>
        )}
        <Folder tab="이번 판" clip>
          <div className="flex flex-col gap-3">
            <Field label="프리셋">
              <select
                value={custom ? 'custom' : presetId}
                onChange={(e) => {
                  if (e.target.value === 'custom') setCustom(true);
                  else { setCustom(false); setPresetId(e.target.value); }
                }}
              >
                {presetList.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                <option value="custom">커스텀</option>
              </select>
            </Field>
            {custom && (
              <>
                {/* 듣기·이진수 커스텀은 그 종목 모양으로 고정 */}
                {style === 'plain' && (
                  <Field label="종목">
                    <select value={mode} onChange={(e) => setMode(e.target.value as PracticeMode)}>
                      <option value="digits">숫자</option>
                      <option value="cards">카드</option>
                    </select>
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={planMode === 'cards' ? '장수 (최대 52)' : style === 'binary' ? '자릿수 (6의 배수로 올림)' : '자릿수'}>
                    <input type="number" min={2} max={planMode === 'cards' ? 52 : style === 'binary' ? 3000 : 1000} value={length}
                      onChange={(e) => setLength(Number(e.target.value))} />
                  </Field>
                  {style === 'plain' && mode === 'digits' && (
                    <Field label="한 칸에 묶을 자릿수">
                      <select value={chunk} onChange={(e) => setChunk(Number(e.target.value))}>
                        <option value={2}>2자리 (00–99)</option>
                        <option value={3}>3자리 (000–999)</option>
                      </select>
                    </Field>
                  )}
                  {style === 'spoken' && (
                    <Field label="낭독 간격 (초, 0.5–3)">
                      <input type="number" min={0.5} max={3} step={0.5} value={customGapSec}
                        onChange={(e) => setCustomGapSec(Number(e.target.value))} />
                    </Field>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {style !== 'spoken' && (
                    <Field label="암기 시간 (초)">
                      <input type="number" min={10} value={memorizeSec} onChange={(e) => setMemorizeSec(Number(e.target.value))} />
                    </Field>
                  )}
                  <Field label="회상 시간 (초)">
                    <input type="number" min={10} value={recallSec} disabled={unlimitedRecall}
                      onChange={(e) => setRecallSec(Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}
            {style === 'spoken' && (
              <>
                {!speechOk && <p className="m-0 font-typek text-xs text-ink">이 브라우저는 음성 합성을 지원하지 않습니다</p>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="목소리 언어">
                    <select
                      value={lang}
                      onChange={(e) => { stopTest(); setVoiceNote(''); saveSettings({ spokenLang: e.target.value as SpokenLang }); }}
                    >
                      <option value="ko">한국어</option>
                      <option value="en">영어</option>
                    </select>
                  </Field>
                  {/* 연습은 낭독을 늦출 수 있다(보조). 모의 대회는 프리셋 간격 그대로 */}
                  {easy && !custom && (
                    <Field label="낭독 간격">
                      <select value={practiceGap} onChange={(e) => setPracticeGap(Number(e.target.value))}>
                        {GAPS.map((g) => <option key={g} value={g}>{g / 1000}초</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Key tone="cream" size="sm" disabled={!speechOk} onClick={testVoice}>소리 시험</Key>
                  {voiceNote && <span className="font-typek text-[11px] text-ink-2">{voiceNote}</span>}
                </div>
              </>
            )}
            {style === 'binary' && (
              <>
                <Field label="변환 방식">
                  <select value={code} onChange={(e) => saveSettings({ binaryCode: e.target.value as BinaryCode })}>
                    {(Object.keys(CODE_LABEL) as BinaryCode[]).map((c) => <option key={c} value={c}>{CODE_LABEL[c]}</option>)}
                  </select>
                </Field>
                {easy && (
                  <label className="flex items-center gap-2 font-typek text-[13px] text-ink">
                    <input type="checkbox" className="size-4" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
                    외우는 동안 바꾼 숫자 보이기
                  </label>
                )}
              </>
            )}
            <Field label="사용할 궁전 (선택)">
              <select value={palaceId} onChange={(e) => setPalaceId(e.target.value)}>
                <option value="">지정 안 함</option>
                {palaces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 font-typek text-[13px] text-ink">
              <input type="checkbox" className="size-4" checked={unlimitedRecall} onChange={(e) => setUnlimitedRecall(e.target.checked)} />
              회상은 시간 제한 없이
            </label>
            {/* 서류철에 물린 종이 한 장 — 이번 판 요약 */}
            <div className="rounded-[4px] bg-card px-3 py-2.5 font-typek text-xs leading-relaxed text-ink-2">
              <div className="font-bold text-ink">이번 설정</div>
              {style === 'spoken'
                ? `숫자 ${planN}자리 · ${gapMs === 1000 ? '초당 1개' : `${gapMs / 1000}초에 1개`}`
                : style === 'binary'
                ? `이진수 ${planN}자리 · 30자리 줄 ${Math.ceil(planN / BINARY_ROW)}줄 · 6자리씩 ${planN / BINARY_CELL}칸`
                : planMode === 'digits'
                ? `숫자 ${planN}자리 · ${chunk}자리씩 ${planN / chunk}칸`
                : `카드 ${planN}장`}
              <br />
              {style === 'spoken'
                ? `낭독 약 ${mmss(readingMs(planN, gapMs))} · 회상 ${recallText}`
                : easy
                ? '암기 무제한 · 회상 무제한'
                : `암기 ${mmss(memorizeSec * 1000)} · 회상 ${recallText}`}
            </div>
            <Key tone="red" size="big" disabled={blocked} onClick={begin}>시작</Key>
          </div>
        </Folder>
      </div>
    );
  }

  /* ───────── 모의 대회 3-2-1 ───────── */
  if (phase === 'countdown') return <Countdown onDone={start} />;

  /* ───────── 암기 ─────────  측정 화면: 장식 없음, 칸 위치 고정 */
  if (phase === 'memorize') {
    /* 듣기 — 낭독만. stimulus 는 판 동안 같은 배열이라 시계 틱에 다시 그려져도 낭독이 다시 시작되지 않는다 */
    if (run.style === 'spoken') {
      return <SpokenListen digits={stimulus} intervalMs={run.intervalMs} lang={run.lang} onDone={toRecall} onCancel={cancelListen} />;
    }
    const left = deadline - nowMs;
    return (
      <div className="flex flex-col gap-3">
        <Hud
          left={<>암기 · <b>{stimulus.length}</b>{mode === 'cards' ? '장' : '자리'}</>}
          right={<Clock ms={easy ? nowMs - startedAt : left} warn={!easy && left < 30000} />}
        />
        <div className="flex gap-2">
          <Key className="flex-1" sub="Enter" onClick={() => toRecall()}>외웠습니다</Key>
          <Key tone="cream" sub="Esc" onClick={() => setPhase('setup')}>취소</Key>
        </div>
        <Panel>
          {mode === 'binary' ? (
            /* 30자리 줄마다 한 블록. 폭 375px 에서 한 줄 5칸이 넘치지 않게 패널 여백을 조금 빌려 쓴다 */
            <div className="-mx-2 flex flex-col gap-3">
              {cellRows(expected).map((row, r) => (
                <div key={r}>
                  <div className="mb-0.5 font-typek text-[10px] text-ink-2">{r + 1}줄</div>
                  <div className="grid grid-cols-5 gap-x-1">
                    {row.map((c, j) => (
                      <div key={j} className="flex min-w-0 flex-col items-center">
                        <span className="tnum inline-flex gap-[2px] text-base leading-tight tracking-[-0.03em] text-ink">
                          {run.code === 'b3' ? splitBits(c).map((p, k) => <span key={k}>{p}</span>) : c}
                        </span>
                        {run.showKeys && <span className="tnum text-[11px] leading-tight text-ink-2">{bitsToKey(c, run.code)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-x-2 gap-y-2">
              {expected.map((c, i) => (
                <span
                  key={i}
                  className={`tnum text-center text-2xl ${mode === 'cards' && 'HD'.includes(c[0]) ? 'text-red' : 'text-ink'}`}
                >
                  {show(c)}
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  /* ───────── 회상 ─────────  측정 화면: 장식 없음, 칸 위치 고정 */
  if (phase === 'recall') {
    const left = deadline - nowMs;
    const open = easy || unlimitedRecall;
    const bin = mode === 'binary';
    /* 휴대폰 이진수 — 기기 키보드 대신 화면 아래 0·1 자판 */
    const pad = bin && coarse;
    const cell = (i: number) => (
      <div key={i} className="flex min-w-0 flex-col items-center">
        {!bin && <span className="tnum text-[10px] text-ink-2">{i + 1}</span>}
        {loci[i] && (
          <span className="w-full truncate text-center font-typek text-[10px] text-ink-2" title={loci[i].name}>
            {loci[i].name}
          </span>
        )}
        {/* 전역 input 규칙(글자 14px)보다 앞서야 해서 ! — 16px 미만이면 휴대폰이 입력 때 화면을 확대한다 */}
        <input
          ref={(el) => { cellRefs.current[i] = el; }}
          defaultValue={answersRef.current[i]}
          onInput={(e) => onCellInput(i, e.currentTarget)}
          onKeyDown={(e) => onCellKey(i, e)}
          onFocus={pad ? (e) => onPadFocus(i, e.currentTarget) : undefined}
          className={bin
            ? `tnum w-full text-center px-0.5! py-1.5! text-base! tracking-[-0.04em] ${pad ? (easy ? 'scroll-mt-16 scroll-mb-[calc(10rem_+_env(safe-area-inset-bottom))]' : 'scroll-mb-[calc(6rem_+_env(safe-area-inset-bottom))]') : ''}`
            : 'tnum w-full text-center px-1! py-1.5! text-lg!'}
          inputMode={pad ? 'none' : mode === 'cards' ? 'text' : 'numeric'}
          autoComplete={bin ? 'off' : undefined}
        />
      </div>
    );
    const cells = answers.map((_, i) => cell(i));
    return (
      <div className="flex flex-col gap-3">
        <Hud
          left={<>회상 · <b>{answers.length}</b>칸</>}
          right={<Clock ms={open ? nowMs - recallStart.current : left} warn={!open && left < 60000} />}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 font-typek text-[11px] leading-snug text-ink-2">
            {mode === 'cards' ? '카드 입력: s7 · ha(에이스) · dt 또는 d10 · ck'
              : bin ? '0과 1만 · 여섯 자리를 채우면 다음 칸' : '기억나는 만큼 채우십시오'}
          </p>
          <Key sub="Ctrl+Enter" onClick={toGrade}>제출</Key>
        </div>
        <Panel>
          {bin ? (
            /* 30자리 줄 블록. 폭 375px 에서 한 줄 5칸이 넘치지 않게 패널 여백을 조금 빌려 쓴다 */
            <div className="-mx-2 flex flex-col gap-3">
              {cellRows(cells).map((row, r) => (
                <div key={r}>
                  <div className="mb-0.5 font-typek text-[10px] text-ink-2">{r + 1}줄</div>
                  <div className="grid grid-cols-5 gap-1">{row}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-1.5">{cells}</div>
          )}
        </Panel>
        {pad && <BinaryPad aboveNav={easy} onPress={padInput} onBackspace={() => padInput(null)} />}
      </div>
    );
  }

  /* 칸별 채점 표 — 채점 화면과 성적표 아래 상세가 같이 쓴다. 정답 = 칠판 초록, 오답 = 파란 연필, 빈칸 = 서류철 */
  const gradeCell = (g: (typeof graded)[number]) => {
    const name = imageNameFor(g.expected);
    return (
      <div
        key={g.index}
        className={`min-w-0 rounded-[4px] border px-1 py-1 text-center ${
          g.isCorrect ? 'border-chalk/40 bg-chalk/10' : g.blank ? 'border-card-edge bg-manila' : 'border-blue/50 bg-blue/10'
        }`}
      >
        {loci[g.index] && (
          <div className="truncate font-typek text-[10px] text-ink-2" title={loci[g.index].name}>
            {loci[g.index].name}
          </div>
        )}
        {/* 이진수 6자리가 휴대폰 폭 한 칸에 들어가게 조금 작게 */}
        <div className={`tnum text-ink ${mode === 'binary' ? 'text-[13px] tracking-tight' : 'text-sm'}`}>{show(g.expected)}</div>
        {name && <div className="truncate font-typek text-[10px] text-ink-2" title={name}>{name}</div>}
        {!g.isCorrect && <div className="tnum text-[11px] text-blue">{g.blank ? '—' : show(g.answered)}</div>}
      </div>
    );
  };
  /* 이진수는 30자리 줄 블록마다 그 줄 점수를 적는다 */
  const gradeGrid = mode === 'binary' ? (
    <div className="mt-4 flex flex-col gap-3">
      {cellRows(graded).map((row, r) => (
        <div key={r}>
          <div className="mb-1 font-typek text-[11px] text-ink-2">
            {r + 1}줄 · <b className="tnum text-ink">{contest?.rows[r]?.score ?? 0}점</b>
          </div>
          <div className="grid grid-cols-5 gap-1.5">{row.map(gradeCell)}</div>
        </div>
      ))}
    </div>
  ) : (
    <div className="mt-4 grid grid-cols-5 gap-1.5">{graded.map(gradeCell)}</div>
  );

  /* ───────── 채점 + 원인 태그 ───────── */
  if (phase === 'grade') {
    return (
      <div className="flex flex-col gap-4">
        <Panel title="채점">
          <div className="grid grid-cols-2 gap-2">
            {contest && (
              <div className="col-span-2">
                {run.style === 'spoken'
                  ? <Stat label="처음 틀린 곳까지" value={`${contest.score}자리`} />
                  : <Stat label="줄 점수" value={`${contest.score}/${contest.max}`} />}
              </div>
            )}
            <Stat label="칸 정답" value={`${score.correct}/${score.total}`} sub={fmtPct(score.total ? score.correct / score.total : 0)} />
            <Stat label="오답" value={score.wrong} />
            <Stat label="미기입" value={score.blank} />
            {digitScore && <Stat label="자릿수 정답" value={`${digitScore.ok}/${digitScore.total}`} />}
          </div>
          {gradeGrid}
        </Panel>

        <Panel
          title={`오답 원인 (${wrongCells.length}칸)`}
          right={<span className="font-typek text-[11px] text-ink-2">1~4 원인 · ↑↓ 이동</span>}
        >
          {wrongCells.length === 0 ? (
            <Empty>틀린 칸이 없습니다.</Empty>
          ) : (
            <ul className="m-0 flex max-h-80 list-none flex-col gap-1.5 overflow-auto p-0">
              {wrongCells.map((g, i) => (
                <li
                  key={g.index}
                  onClick={() => setCursor(i)}
                  className={`cursor-pointer rounded-[4px] border px-2.5 py-2 ${
                    i === cursor ? 'border-ink bg-manila' : 'border-card-edge'
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="tnum text-xs text-ink-2">#{g.index + 1}</span>
                    <span className="tnum text-[15px] text-ink">
                      {show(g.expected)}
                      <span className="text-blue"> ← {g.blank ? '—' : show(g.answered)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {TAGS.map((t, ti) => {
                      const on = (tags[g.index] ?? []).includes(t);
                      return (
                        <Key
                          key={t}
                          size="sm"
                          tone={on ? 'ink' : 'cream'}
                          aria-pressed={on}
                          onClick={(e) => { e.stopPropagation(); toggleTag(g.index, t); }}
                        >
                          {ti + 1} {ERROR_TAG_LABEL[t]}
                        </Key>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Key tone="red" onClick={save}>기록 저장</Key>
            <Key tone="cream" onClick={() => setPhase('recall')}>회상으로 돌아가기</Key>
          </div>
        </Panel>
      </div>
    );
  }

  /* ───────── 성적표 ─────────  공개 중 아무 키 = 건너뛰기, 끝난 뒤 Enter = 한 판 더(ResultSheet 가 처리) */
  if (!outcome) return null;
  const recallLimit = unlimitedRecall ? '무제한' : mmss(recallSec * 1000);
  const limitText = easy ? '시간 제한 없음'
    : run.style === 'spoken' ? `낭독 ${mmss(stimulus.length * run.intervalMs)} · 회상 제한 ${recallLimit}`
    : `제한 ${mmss(memorizeSec * 1000)} / ${recallLimit}`;
  return (
    <ResultSheet
      outcome={outcome}
      onAgain={begin}
      sage={coach.sage}
      actions={
        <>
          <CourseBar step={course} sessionId={sessionId} played={{ kind: 'event', presetId: custom ? null : presetId, run: runMode }} />
          <div className="flex gap-2">
            <Key tone="cream" className="flex-1" onClick={() => setPhase('setup')}>설정 바꾸기</Key>
            <KeyLink to="/stats" tone="cream" className="flex-1">기록 보기</KeyLink>
          </div>
          {coach.action}
        </>
      }
    >
      <Panel title="채점 상세">
        <div className="grid grid-cols-2 gap-2">
          {/* 듣기·이진수 성적표의 글자판은 대회 점수가 차지해 맞힌 칸을 여기에 둔다 */}
          {contest && <Stat label="맞힌 칸" value={`${score.correct}/${score.total}`} />}
          <Stat label="오답" value={score.wrong} />
          <Stat label="미기입" value={score.blank} />
          {digitScore && <Stat label="자릿수 정답" value={`${digitScore.ok}/${digitScore.total}`} />}
          <Stat label="합계 시간" value={mmss(memorizeUsedMs + recallUsedMs)} sub={limitText} />
        </div>
        {gradeGrid}
        <p className="mt-3 font-typek text-[11px] text-ink-2">세션 {sessionId.slice(0, 8)} · 출제 수열과 칸별 기록이 모두 저장되었습니다.</p>
      </Panel>
    </ResultSheet>
  );
}
