/**
 * 물리 키 위치 → 자음. 두벌식 자판 배열 그대로다.
 *
 * `event.key` 가 아니라 `event.code`(물리 위치)를 쓰는 이유: 한/영 상태와 무관하게 같은 키가
 * 같은 자음으로 들어온다. 한글 입력기를 켜 두실 필요가 없고, 켜 두셔도 문제없다.
 * 쌍자음(ㄲㄸㅃㅆㅉ)은 어차피 같은 숫자에 속하므로 기본 자음만 받으면 충분하다.
 */
const CODE_TO_JAMO: Record<string, string> = {
  KeyQ: 'ㅂ', KeyW: 'ㅈ', KeyE: 'ㄷ', KeyR: 'ㄱ', KeyT: 'ㅅ',
  KeyA: 'ㅁ', KeyS: 'ㄴ', KeyD: 'ㅇ', KeyF: 'ㄹ', KeyG: 'ㅎ',
  KeyZ: 'ㅋ', KeyX: 'ㅌ', KeyC: 'ㅊ', KeyV: 'ㅍ',
};

const ALL_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/**
 * 키 입력에서 자음을 뽑는다. 세 경로를 모두 받는다.
 * 1. 한글 입력기가 자음을 직접 보낸 경우 ('ㅈ')
 * 2. 물리 키 위치 (code === 'KeyW')
 * 3. 영문 글자 (key === 'w') — code 를 채우지 않는 환경이 있고, 영문 상태에서도 그대로 통한다
 */
export function jamoFromKey(e: KeyboardEvent): string | null {
  if (e.key && ALL_JAMO.includes(e.key)) return e.key;
  if (e.code && CODE_TO_JAMO[e.code]) return CODE_TO_JAMO[e.code];
  if (e.key && /^[a-zA-Z]$/.test(e.key)) return CODE_TO_JAMO[`Key${e.key.toUpperCase()}`] ?? null;
  return null;
}
