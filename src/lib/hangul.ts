/** 한글 초성 ↔ 숫자 코드 변환. 자음 매핑은 설정에서 바꿀 수 있으므로 항상 인자로 받는다. */

export type ChosungMap = Record<string, string>; // '1' -> 'ㄱㅋㄲ'

export const DEFAULT_CHOSUNG_MAP: ChosungMap = {
  '1': 'ㄱㅋㄲ',
  '2': 'ㄴ',
  '3': 'ㄷㅌㄸ',
  '4': 'ㄹ',
  '5': 'ㅁ',
  '6': 'ㅂㅍㅃ',
  '7': 'ㅅㅆ',
  '8': 'ㅈㅊㅉ',
  '9': 'ㅎ',
  '0': 'ㅇ',
};

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const SYL_BASE = 0xac00;
const SYL_LAST = 0xd7a3;

/** 문자열에서 한글 음절의 초성만 순서대로 뽑는다. 공백·기호·영문은 무시. */
export function chosungOf(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= SYL_BASE && code <= SYL_LAST) {
      out.push(CHOSUNG[Math.floor((code - SYL_BASE) / 588)]);
    } else if (CHOSUNG.includes(ch)) {
      out.push(ch); // 'ㄱ' 처럼 자음만 입력한 경우
    }
  }
  return out;
}

/** 초성 -> 숫자. 매핑에 없으면 null. */
export function digitOfChosung(c: string, map: ChosungMap): string | null {
  for (const [digit, letters] of Object.entries(map)) {
    if (letters.includes(c)) return digit;
  }
  return null;
}

/** '기차' -> '18'. 매핑 불가 초성이 하나라도 있으면 null. */
export function codeOfName(name: string, map: ChosungMap): string | null {
  const cs = chosungOf(name);
  if (cs.length === 0) return null;
  const digits = cs.map((c) => digitOfChosung(c, map));
  if (digits.some((d) => d === null)) return null;
  return digits.join('');
}

/** 숫자 키('17')를 초성 힌트로: 'ㄱㅋㄲ · ㅅㅆ' */
export function hintForKey(key: string, map: ChosungMap): string {
  return key
    .split('')
    .map((d) => map[d] ?? '?')
    .join(' · ');
}

export type MatchKind = 'exact' | 'alias' | 'chosung' | 'none';

/**
 * 타이핑 검증 채점.
 * 1) 정확 일치 → 2) alias 일치 → 3) 초성 코드가 키로 시작하면 인정.
 *
 * 3번을 '같음'이 아니라 '로 시작함'으로 두는 이유: 키가 두 자리라도 좋은 이미지는
 * '너구리'(ㄴㄱㄹ)처럼 음절이 더 길 때가 많다. 앞 두 초성이 코드와 맞으면 변환은 맞은 것이다.
 * 덕분에 '기차'/'기차역'/'긴 차' 같은 표기 흔들림도 훈련을 방해하지 않는다.
 */
export function matchName(
  input: string,
  target: { key: string; name: string; aliases: string[] },
  map: ChosungMap,
  keyIsDigits: boolean,
): MatchKind {
  const norm = (s: string) => s.replace(/\s+/g, '').trim();
  const i = norm(input);
  if (!i) return 'none';
  if (i === norm(target.name)) return 'exact';
  if (target.aliases.some((a) => norm(a) === i)) return 'alias';
  if (keyIsDigits) {
    const code = codeOfName(i, map);
    if (code && code.startsWith(target.key)) return 'chosung';
  }
  return 'none';
}
