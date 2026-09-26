import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHOSUNG_MAP, type ChosungMap } from '../lib/hangul';
import {
  DEFAULT_RANK_DIGITS, DEFAULT_SUIT_DIGITS, faceKeys, faceOrder,
  type RankDigits, type SuitDigits,
} from '../lib/cards';
import { uid } from '../lib/random';
import type { BinaryCode } from '../lib/binary';
import type { SpokenLang } from '../lib/spoken';
import type { Course, Review } from '../coach/types';

/* ───────────────── 타입 ───────────────── */

export type SetDomain = 'digit2' | 'digit3' | 'cardFace' | 'card2' | 'custom';

export interface ImageSet {
  id: string;
  name: string;
  domain: SetDomain;
  /** 키 공간 생성기. 없으면 사용자가 직접 키를 추가하는 세트. */
  keyGenerator?: 'digits:2' | 'digits:3' | 'cardFaces' | 'cards:2';
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MemoImage {
  id: string;
  setId: string;
  /** '00'~'99' | 'SJ' | 'S7-HK' — 문자열이므로 어떤 확장도 스키마 변경이 필요 없다. */
  key: string;
  name: string;
  aliases: string[];
  note: string;
  /** PAO 확장 슬롯 (MVP 화면에는 노출하지 않음) */
  person?: string;
  object?: string;
  action?: string;
  tags: string[];
  updatedAt: number;
}

export type PickMode = 'srs' | 'all' | 'weak' | 'unseen';

export interface DrillSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  setIds: string[];
  pickMode: PickMode;
  itemCount: number;
  /** 1 = 모든 문항을 타이핑으로 채점. 자가 채점을 쓰던 시절 기록은 0.1 처럼 남아 있다. */
  typedCheckRate: number;
}

export type Verdict = 'correct' | 'wrong' | 'skip';

export interface DrillAttempt {
  id: string;
  sessionId: string;
  order: number;
  imageId: string;
  setId: string;
  key: string;
  /** 카드로 출제된 경우 원본 카드 코드 */
  stimulus?: string;
  rtMs: number;
  verdict: Verdict;
  typedInput?: string;
  typedMatch?: 'exact' | 'alias' | 'chosung' | 'none';
  shownAt: number;
}

/** 듣고 외우는 숫자는 'digits' + eventId 'spoken-numbers' 로 저장한다(칸 모양이 숫자와 같다). */
export type PracticeMode = 'digits' | 'cards' | 'binary';

export interface RecallSession {
  id: string;
  mode: PracticeMode;
  presetName: string;
  /** 어느 대회 종목으로 한 것인지 (data/events.ts 의 id) */
  eventId?: string;
  /** 'easy' 연습 · 'real' 실전 */
  runMode?: 'easy' | 'real';
  /** 실제 출제 수열. 그대로 저장해 재현·복기가 가능하다. */
  stimulus: string[];
  palaceId?: string;
  memorizeMs: number;
  memorizeUsedMs: number;
  recallMs: number;
  /** 회상에 실제로 쓴 시간 (색인이 아니므로 버전을 올리지 않아도 된다) */
  recallUsedMs?: number;
  startedAt: number;
  endedAt?: number;
  correct: number;
  wrong: number;
  blank: number;
  /*
   * 아래 둘은 색인이 아닌 칸이라 버전을 올리지 않았다(P3). 기존 종목은 비워 둔다.
   */
  /** 대회식 점수 — 듣기는 처음 틀린 곳까지 맞힌 자리 수, 이진수는 줄 점수 */
  score?: number;
  /** 그 판 조건 사본 — 듣기 { intervalMs, lang }, 이진수 { code, rowLen }. 설정을 바꿔도 옛 판의 뜻이 남는다. */
  params?: RuleValues;
}

export type ErrorTag = 'image' | 'locus' | 'link' | 'order' | 'blank';

export const ERROR_TAG_LABEL: Record<ErrorTag, string> = {
  image: '이미지 혼동',
  locus: '장소',
  link: '연결',
  order: '순서',
  blank: '백지',
};

export interface RecallCell {
  id: string;
  sessionId: string;
  index: number;
  expected: string;
  answered: string;
  isCorrect: boolean;
  errorTags: ErrorTag[];
}

export interface Palace {
  id: string;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Locus {
  id: string;
  palaceId: string;
  order: number;
  name: string;
  note: string;
}

export interface ImageStat {
  imageId: string;
  setId: string;
  attempts: number;
  correct: number;
  wrong: number;
  /** 최근 30개 반응시간만 유지 (원시 전량은 drillAttempts 에 남는다) */
  rtSamples: number[];
  meanRt: number;
  medianRt: number;
  wrongStreak: number;
  lastSeenAt: number;
}

/** 3단계에서 무엇을 자극으로 낼지. 숫자·키 / 카드 / 섞기. */
export type StimulusStyle = 'key' | 'card' | 'mix';

export interface AppSettings {
  key: 'app';
  chosungMap: ChosungMap;
  suitDigits: SuitDigits;
  rankDigits: RankDigits;
  drillCount: number;
  /**
   * 3단계 설정을 마지막 상태로 되살리기 위한 값들.
   *
   * 회장은 보통 같은 묶음을 며칠씩 판다. 열 때마다 세트와 열 묶음을 다시 고르게 하면
   * 훈련을 시작하기 전에 손이 먼저 지친다. 없으면(첫 실행) 기본값으로 떨어진다.
   */
  drillSetIds?: string[];
  /** 세트 id -> 낼 앞자리 목록. 빈 배열 = 전부. */
  drillDecades?: Record<string, string[]>;
  drillPickMode?: PickMode;
  drillStyle?: StimulusStyle;
  /** 초급 단계에서 낼 방향. 기본은 외울 때 쓰는 숫자 → 자음. */
  mappingDirection: 'toConsonant' | 'toDigit' | 'mix';
  /** 마지막으로 백업 파일을 받은 때. 데이터는 이 브라우저 안에만 있어 백업이 유일한 보험이다. */
  lastBackupAt?: number;
  /** 기기 간 동기화 코드. 없으면 동기화 꺼짐. */
  syncCode?: string;
  /** 마지막으로 동기화한 때. 기기마다 다른 값이라 동기화 대상에서 뺀다. */
  lastSyncAt?: number;
  /**
   * 회상 칸을 한 번 전부 올렸는지. 2026-09-26 전 동기화는 칸을 빠뜨렸다(칸에 시각이 없어서).
   * 없으면 다음 동기화가 칸 전체를 한 번 올린다(`sync/engine.ts`). 기기마다 다른 값이라 동기화에서 뺀다.
   */
  recallCellsSynced?: boolean;
  /**
   * AI 이름 후보를 받을 때 쓰는 Anthropic 키.
   *
   * **이 브라우저 안에만 둔다.** 코드에 넣지 않고(저장소가 공개다) 기기 동기화에서도 뺀다
   * (`sync/engine.ts` 의 collectAssets). 비어 있으면 사전 후보만 쓴다.
   */
  aiKey?: string;
  /** 움직임 줄이기. 없으면 기기 설정(prefers-reduced-motion)을 따른다. */
  reduceMotion?: boolean;
  /** 효과음. 없으면 켬(디자인 시스템 기본값, 회장 청취 확인 전). */
  soundOn?: boolean;
  /** 하루 목표 시간(분). 짧은 세션도 '오늘 채운 분' 으로 쌓인다. */
  dailyMinutes: number;
  /** 스승님이 하루 한 번 스스로 코스를 짜 줄지. 없으면 켬(키가 있을 때만 부른다) */
  coachAuto?: boolean;
  /** 이진수 6자리를 숫자 이미지로 바꾸는 방식. 없으면 DEFAULT_BINARY_CODE(lib/binary) */
  binaryCode?: BinaryCode;
  /** 듣기 종목 낭독 언어. 없으면 DEFAULT_SPOKEN_LANG(lib/spoken) */
  spokenLang?: SpokenLang;
  seededAt?: number;
}

/* ── 계산 영역 (DB v3) ── */

/** 연습 = 보조를 켜는 자리, 모의 대회 = 규정대로 혼자 치르는 판 */
export type CalcMode = 'practice' | 'contest';

/** 규정·연습 설정 값. 칸 목록은 종목 등록부가 정한다. */
export type RuleValues = Record<string, number | string>;

export interface CalcSession {
  id: string;
  disciplineId: string;
  mode: CalcMode;
  /** 그때 쓴 규정 사본. 규정을 나중에 바꿔도 옛 기록의 뜻이 흐트러지지 않는다. */
  rules: RuleValues;
  /** 연습 설정(자릿수·개수 등) */
  params: RuleValues;
  /** 같은 시드면 같은 문제 — 복기·재도전, 2단계에서 서버가 같은 문제를 검증하는 토대 */
  seed: string;
  startedAt: number;
  endedAt?: number;
  correct: number;
  wrong: number;
  score: number;
}

export interface CalcStep {
  name: string;
  ms: number;
  given?: string;
  ok?: boolean;
}

/** 문항 하나. drillAttempts·recallCells 와 같은 원시 데이터 — 지우거나 요약으로 바꾸지 않는다. */
export interface CalcItem {
  id: string;
  sessionId: string;
  index: number;
  /** 문제 유형 (서프라이즈의 'sq:3' 같은 것) */
  kind: string;
  prompt: string;
  expected: string;
  answered: string;
  isCorrect: boolean;
  rtMs: number;
  /** 달력 단계 입력처럼 단계마다 잰 시간 */
  steps?: CalcStep[];
  /** 플래시 암산 문항 — 설정 간격과 수마다 실제로 보인 시간·주기(색인이 아닌 칸이라 DB 버전 그대로, P5) */
  flash?: { intervalMs: number; shownMs: number[]; periodMs: number[] };
  shownAt: number;
}

/** 대회 규정 한 벌. 지금은 종목마다 '내 규정' 하나(id = `${disciplineId}:default`). */
export interface Ruleset {
  id: string;
  disciplineId: string;
  name: string;
  values: RuleValues;
  isDefault: boolean;
  updatedAt: number;
}

/* ── 스승님과 커리큘럼 (DB v3) ── */

export interface CoachLog {
  id: string;
  kind: 'course' | 'review' | 'weekly';
  at: number;
  /** 보낸 훈련 요약표 */
  input: unknown;
  /** 받은 답 원문 */
  output: string;
  /** 코스를 실제로 따라 했는가 — 스승님과 규칙 코치를 견주는 근거 */
  followed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /*
   * 아래는 색인이 아닌 칸이라 DB 버전을 올리지 않고 더했다(P2).
   * AI 를 부른 행 = source 'ai' 이거나 aiError 가 있는 행 — 이번 달 사용량과 자동 호출 상한이 이것을 센다.
   */
  /** 코스를 누가 짰나. 복기 행은 늘 'ai' */
  source?: 'ai' | 'rule';
  /** 스승님께 물었다가 실패한 까닭 — 이때 course 는 규칙 코치가 짠 것이다 */
  aiError?: string;
  /** 검사를 마친 코스(코스 행) */
  course?: Course;
  /** 항목별로 끝낸 세션 id(아직이면 null). 다 차면 followed = true */
  done?: (string | null)[];
  /** 코스를 짠 분량(분) */
  minutes?: number;
  /** 코스를 짠 날(YYYY-MM-DD, 현지) */
  day?: string;
  /**
   * 코스 행: 다른 코스로 갈아 끼웠거나(다시 짜기·시간 바꾸기·자동 스승님 코스) 하던 코스 뒤로 물려 끝내 보이지 않은 행.
   * AI 코스와 규칙 코스를 '따라 한 비율' 로 견줄 때(§8.2) 이런 행은 뺀다.
   * course 가 없는 코스 행은 자동 호출의 자리표(묻는 중이거나, 묻다 창이 닫혀 답을 못 받은 것)다 — 호출 1회로만 센다.
   */
  superseded?: boolean;
  /** 복기 행: 어느 판을 복기했나 */
  sessionId?: string;
  /** 복기 행: 검사를 마친 스승님 말 */
  review?: Review;
}

/** 큰 목표 하나. 주간 이정표는 저장하지 않고 지금 최고 기록과 기한 사이를 코드가 나눈다. */
export interface Target {
  id: string;
  disciplineId: string;
  /** 무엇으로 재나 (예: 'count60s', 'totalMs') — 종목이 정한다 */
  metric: string;
  value: number;
  deadline?: number;
  setBy: 'chairman' | 'coach';
  status: 'active' | 'done' | 'dropped';
  createdAt: number;
  updatedAt: number;
}

/** 사다리 위치. 통과 여부는 기록에서 계산하고, 여기는 '지금 어느 칸에서 하나'만 남는다(한 칸 내리기 때문). */
export interface LadderState {
  ladderId: string;
  currentLevel: string;
  updatedAt: number;
}

/* ── 초급 단계 (자음 매핑 외우기) ── */

export interface MappingSession {
  id: string;
  stage: 1 | 2;
  startedAt: number;
  endedAt?: number;
  itemCount: number;
}

export interface MappingAttempt {
  id: string;
  sessionId: string;
  order: number;
  stage: 1 | 2;
  /** '7' 또는 '47' — 통계를 쌓는 단위 */
  unit: string;
  direction: 'toConsonant' | 'toDigit';
  prompt: string;
  answer: string;
  given: string;
  isCorrect: boolean;
  rtMs: number;
  shownAt: number;
}

export interface MappingStat {
  /** 's1:7' | 's2:47' */
  key: string;
  stage: 1 | 2;
  unit: string;
  attempts: number;
  correct: number;
  wrong: number;
  rtSamples: number[];
  medianRt: number;
  wrongStreak: number;
  lastSeenAt: number;
}

/* ───────────────── DB ───────────────── */

class MemoryGymDB extends Dexie {
  imageSets!: Table<ImageSet, string>;
  images!: Table<MemoImage, string>;
  drillSessions!: Table<DrillSession, string>;
  drillAttempts!: Table<DrillAttempt, string>;
  recallSessions!: Table<RecallSession, string>;
  recallCells!: Table<RecallCell, string>;
  palaces!: Table<Palace, string>;
  loci!: Table<Locus, string>;
  imageStats!: Table<ImageStat, string>;
  settings!: Table<AppSettings, string>;
  mappingSessions!: Table<MappingSession, string>;
  mappingAttempts!: Table<MappingAttempt, string>;
  mappingStats!: Table<MappingStat, string>;
  calcSessions!: Table<CalcSession, string>;
  calcItems!: Table<CalcItem, string>;
  rulesets!: Table<Ruleset, string>;
  coachLogs!: Table<CoachLog, string>;
  targets!: Table<Target, string>;
  ladderState!: Table<LadderState, string>;

  constructor() {
    super('memory-gym');
    this.version(1).stores({
      imageSets: 'id, name, domain',
      images: 'id, setId, &[setId+key], name, updatedAt',
      drillSessions: 'id, startedAt',
      drillAttempts: 'id, sessionId, imageId, shownAt',
      recallSessions: 'id, startedAt, mode',
      recallCells: 'id, sessionId, [sessionId+index]',
      palaces: 'id, name',
      loci: 'id, palaceId, [palaceId+order]',
      imageStats: 'imageId, setId, medianRt, lastSeenAt',
      settings: 'key',
    });

    /* v2: 자음 매핑을 외우는 초급 단계. 기존 표는 그대로 넘어온다. */
    this.version(2).stores({
      mappingSessions: 'id, startedAt, stage',
      mappingAttempts: 'id, sessionId, shownAt, unit',
      mappingStats: 'key, stage, lastSeenAt',
    });

    /* v3: 계산 영역 · 규정 · 스승님 · 커리큘럼. 표를 더하기만 한다 — 기존 표는 모양도 내용도 그대로다. */
    this.version(3).stores({
      calcSessions: 'id, startedAt, disciplineId',
      calcItems: 'id, sessionId, shownAt, [sessionId+index]',
      rulesets: 'id, disciplineId',
      coachLogs: 'id, at, kind',
      targets: 'id, disciplineId, status',
      ladderState: 'ladderId',
    });
  }
}

export const db = new MemoryGymDB();

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  chosungMap: DEFAULT_CHOSUNG_MAP,
  suitDigits: DEFAULT_SUIT_DIGITS,
  rankDigits: DEFAULT_RANK_DIGITS,
  drillCount: 30,
  mappingDirection: 'toConsonant',
  dailyMinutes: 15,
};

export async function getSettings(): Promise<AppSettings> {
  /* 기본값을 덮어 씌우는 식으로 합친다. 나중에 항목이 늘어도 옛 기록에 구멍이 나지 않는다. */
  const stored = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...stored, key: 'app' };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, key: 'app' });
}

/* ───────────────── 키 공간 생성 ───────────────── */

/** 세트 종류에 맞는 키 정렬. 카드는 ♠♥♦♣ × J·Q·K 순, 나머지는 키 문자열 순. */
export function compareKeys(domain: SetDomain, a: string, b: string): number {
  if (domain === 'cardFace') return faceOrder(a) - faceOrder(b);
  return a.localeCompare(b);
}

export function generateKeys(gen: ImageSet['keyGenerator']): string[] {
  switch (gen) {
    case 'digits:2':
      return Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
    case 'digits:3':
      return Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0'));
    case 'cardFaces':
      return faceKeys();
    default:
      return [];
  }
}

const now = () => Date.now();

export function blankImage(setId: string, key: string): MemoImage {
  return { id: uid(), setId, key, name: '', aliases: [], note: '', tags: [], updatedAt: now() };
}

/** 세트의 키 공간 중 아직 행이 없는 키를 빈 이미지로 채운다. */
export async function ensureKeys(set: ImageSet): Promise<number> {
  const keys = generateKeys(set.keyGenerator);
  if (keys.length === 0) return 0;
  const existing = new Set((await db.images.where('setId').equals(set.id).toArray()).map((i) => i.key));
  const missing = keys.filter((k) => !existing.has(k)).map((k) => blankImage(set.id, k));
  if (missing.length) await db.images.bulkAdd(missing);
  return missing.length;
}

/** 최초 실행 시 기본 세트(숫자 00-99, 인물 12장)를 만든다. */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.imageSets.count();
  if (count > 0) return;
  const t = now();
  const sets: ImageSet[] = [
    { id: uid(), name: '숫자 00–99', domain: 'digit2', keyGenerator: 'digits:2', builtin: true, createdAt: t, updatedAt: t },
    { id: uid(), name: '카드 인물 12장', domain: 'cardFace', keyGenerator: 'cardFaces', builtin: true, createdAt: t, updatedAt: t },
  ];
  await db.imageSets.bulkAdd(sets);
  for (const s of sets) await ensureKeys(s);
  await db.settings.put({ ...DEFAULT_SETTINGS, seededAt: t });
}

export async function getSetByDomain(domain: SetDomain): Promise<ImageSet | undefined> {
  return db.imageSets.where('domain').equals(domain).first();
}
