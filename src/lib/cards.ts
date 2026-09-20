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

/**
 * 인물 카드 12장에는 숫자 코드가 없다.
 * A~10 이 0~9 열 자리를 모두 쓰므로 J/Q/K 에 줄 숫자가 남지 않는다.
 * 그래서 이 12장만 코드 밖에 있고, 무엇을 넣든 자유다.
 *
 * 대신 떠올릴 실마리가 없으면 12장이 통째로 흔들린다. 아래는 그 실마리로 쓰는 관습이며
 * 기억술 표준이 아니라 이 앱이 제안하는 기본값이다. 바꾸셔도 된다.
 * 무늬 = 세계 하나, 랭크 = 그 세계 안의 자리.
 */
export const SUIT_WORLD: Record<Suit, string> = {
  S: '싸우는 사람',
  H: '불과 사랑',
  D: '캐고 가진 사람',
  C: '풀과 나무',
};

export const FACE_ROLE: Record<string, string> = {
  J: '일하는 젊은이',
  Q: '여성',
  K: '우두머리',
};

/** 'DQ' -> '♦ 캐고 가진 사람 · Q 여성' */
export function faceHint(code: CardCode): string | null {
  const p = parseCard(code);
  if (!p || !FACE_ROLE[p.rank]) return null;
  return `${SUIT_SYMBOL[p.suit]} ${SUIT_WORLD[p.suit]} · ${p.rank} ${FACE_ROLE[p.rank]}`;
}

const FACE_RANKS: Rank[] = ['J', 'Q', 'K'];

/** 인물 카드 정렬 순서. 문자열 정렬은 ♣J ♣K ♣Q 처럼 어긋나므로 쓰지 않는다. */
export function faceOrder(code: CardCode): number {
  const p = parseCard(code);
  if (!p) return 999;
  return SUITS.indexOf(p.suit) * 3 + FACE_RANKS.indexOf(p.rank);
}
