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
  /** 실제 출제 수열. 그대로 저장해 재현·복기가 가능하다. */
  stimulus: string[];
  palaceId?: string;
  memorizeMs: number;
  memorizeUsedMs: number;
  recallMs: number;
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
  seededAt?: number;
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
};

export async function getSettings(): Promise<AppSettings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS;
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
