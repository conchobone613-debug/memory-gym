import Dexie, { type Table } from 'dexie';
import { DEFAULT_CHOSUNG_MAP, type ChosungMap } from '../lib/hangul';
import {
  DEFAULT_RANK_DIGITS, DEFAULT_SUIT_DIGITS, faceKeys, faceOrder,
  type RankDigits, type SuitDigits,
} from '../lib/cards';
import { uid } from '../lib/random';

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

export type PracticeMode = 'digits' | 'cards';

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

export interface AppSettings {
  key: 'app';
  chosungMap: ChosungMap;
  suitDigits: SuitDigits;
  rankDigits: RankDigits;
  typedCheckRate: number;
  drillCount: number;
  /** 초급 단계에서 낼 방향. 기본은 외울 때 쓰는 숫자 → 자음. */
  mappingDirection: 'toConsonant' | 'toDigit' | 'mix';
  /** 마지막으로 백업 파일을 받은 때. 데이터는 이 브라우저 안에만 있어 백업이 유일한 보험이다. */
  lastBackupAt?: number;
  /** 기기 간 동기화 코드. 없으면 동기화 꺼짐. */
  syncCode?: string;
  /** 마지막으로 동기화한 때. 기기마다 다른 값이라 동기화 대상에서 뺀다. */
  lastSyncAt?: number;
  seededAt?: number;
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
  }
}

export const db = new MemoryGymDB();

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  chosungMap: DEFAULT_CHOSUNG_MAP,
  suitDigits: DEFAULT_SUIT_DIGITS,
  rankDigits: DEFAULT_RANK_DIGITS,
  typedCheckRate: 0.1,
  drillCount: 30,
  mappingDirection: 'toConsonant',
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
