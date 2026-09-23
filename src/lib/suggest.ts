import { CONCRETE_NOUNS } from '../data/nouns';
import { codeOfName, type ChosungMap } from './hangul';
import type { SetDomain } from '../db/db';

/**
 * 빈 칸에 넣을 이름 후보를 고른다.
 *
 * 규칙은 타이핑 채점과 같다 — 초성 코드가 키로 **시작하면** 된다. 그래서 '너구리'(214) 도
 * 21 의 후보가 된다. 앞자리만 맞으면 변환은 성립한다.
 *
 * 짧은 것을 앞에 둔다. 두 음절이 떠올리기도 치기도 빠르다.
 */
export interface Suggestion {
  name: string;
  /** 이미 다른 칸이 쓰고 있는 이름인가 */
  taken: boolean;
}

export function suggestNames(
  key: string,
  map: ChosungMap,
  usedNames: Iterable<string>,
  /* 화면은 5개씩 끊어 보여 준다. 여기서는 넉넉히 주고 '다른 후보' 로 넘겨 가며 본다. */
  limit = 30,
): Suggestion[] {
  const used = new Set([...usedNames].map((n) => n.replace(/\s+/g, '')));
  const hits: string[] = [];

  for (const word of CONCRETE_NOUNS) {
    const code = codeOfName(word, map);
    if (code && code.startsWith(key)) hits.push(word);
  }

  return hits
    .sort((a, b) => a.length - b.length || a.localeCompare(b, 'ko'))
    .slice(0, limit)
    .map((name) => ({ name, taken: used.has(name.replace(/\s+/g, '')) }));
}

/** 인물 카드에는 초성 규칙이 없다. 눈에 띄는 원형만 추린다. */
export const FACE_SUGGESTIONS = [
  '검투사', '광부', '기사', '나무꾼', '노인', '농부', '대장장이', '마녀', '마술사', '무용수',
  '뱃사공', '산신령', '선장', '소방관', '수녀', '신부', '어릿광대', '여왕', '왕', '요리사',
  '의적', '장군', '정원사', '천사', '카우보이', '탐정', '파일럿', '해녀', '해적', '화가',
];

/**
 * 한 칸의 후보를 그 칸이 속한 세트 기준으로 뽑는다.
 * 세트 편집기와 결과 화면의 팝업이 같은 목록을 보여야 하므로 한 곳에 둔다.
 */
export function suggestFor(
  draft: { id: string; key: string },
  siblings: { id: string; name: string }[],
  domain: SetDomain,
  map: ChosungMap,
): Suggestion[] {
  const used = siblings.filter((i) => i.id !== draft.id && i.name.trim()).map((i) => i.name);
  if (domain === 'cardFace') {
    const taken = new Set(used.map((n) => n.replace(/\s+/g, '')));
    return FACE_SUGGESTIONS.map((name) => ({ name, taken: taken.has(name) }));
  }
  return suggestNames(draft.key, map, used);
}
