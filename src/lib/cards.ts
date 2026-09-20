/** 카드 ↔ 이미지 키 변환. 무늬·랭크 매핑은 설정값이므로 하드코딩하지 않는다. */

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: '스페이드', H: '하트', D: '다이아', C: '클럽' };
export const RED_SUITS: Suit[] = ['H', 'D'];

export type SuitDigits = Record<Suit, string>;
export type RankDigits = Record<Rank, string>; // J/Q/K 는 '' (인물 카드)

export const DEFAULT_SUIT_DIGITS: SuitDigits = { S: '1', H: '2', D: '3', C: '4' };
export const DEFAULT_RANK_DIGITS: RankDigits = {
  A: '1', '2': '2', '3': '3', '4': '4', '5': '5',
  '6': '6', '7': '7', '8': '8', '9': '9', '10': '0',
  J: '', Q: '', K: '',
};

/** 'S7', 'HK' 같은 카드 코드 */
export type CardCode = string;

export function cardCode(suit: Suit, rank: Rank): CardCode {
  return suit + rank;
}

export function parseCard(code: CardCode): { suit: Suit; rank: Rank } | null {
  const suit = code[0] as Suit;
  const rank = code.slice(1) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) return null;
  return { suit, rank };
}

export function cardLabel(code: CardCode): string {
  const p = parseCard(code);
  return p ? SUIT_SYMBOL[p.suit] + p.rank : code;
}

export function isFaceCard(code: CardCode): boolean {
  const p = parseCard(code);
  return !!p && (p.rank === 'J' || p.rank === 'Q' || p.rank === 'K');
}

export function fullDeck(): CardCode[] {
  return SUITS.flatMap((s) => RANKS.map((r) => cardCode(s, r)));
}

/** 인물 카드 12장의 키 목록 (별도 세트) */
export function faceKeys(): CardCode[] {
  return SUITS.flatMap((s) => (['J', 'Q', 'K'] as Rank[]).map((r) => cardCode(s, r)));
}

/**
 * 카드 한 장이 어느 세트의 어느 키인지 결정한다.
 * A~10 은 숫자 세트의 2자리 키를 재사용하고, J/Q/K 만 인물 세트에서 찾는다.
 */
export function resolveCard(
  code: CardCode,
  suitDigits: SuitDigits,
  rankDigits: RankDigits,
): { domain: 'digit2' | 'cardFace'; key: string } | null {
  const p = parseCard(code);
  if (!p) return null;
  if (isFaceCard(code)) return { domain: 'cardFace', key: code };
  const d = rankDigits[p.rank];
  if (!d) return null;
  return { domain: 'digit2', key: suitDigits[p.suit] + d };
}

const SUIT_INPUT: Record<string, Suit> = {
  s: 'S', h: 'H', d: 'D', c: 'C', '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C',
};
const RANK_INPUT: Record<string, Rank> = {
  a: 'A', t: '10', '10': '10', '0': '10', j: 'J', q: 'Q', k: 'K',
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
};

/**
 * 회상 입력 정규화. 's7' 'HA' '♠10' 'dk' 를 카드 코드로 바꾼다.
 * 에이스는 a, 10은 t 또는 10 으로 받는다 ('1' 단독은 A/10 이 모호해 받지 않는다).
 */
export function normalizeCardInput(raw: string): CardCode | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (s.length < 2) return null;
  const suit = SUIT_INPUT[s[0]];
  const rank = RANK_INPUT[s.slice(1)];
  return suit && rank ? cardCode(suit, rank) : null;
}
