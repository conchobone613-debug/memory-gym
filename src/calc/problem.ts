/*
 * 계산 문항 한 개의 모양 — 달력을 뺀 모든 계산 종목(제곱근·덧셈·곱셈·서프라이즈)이 같은 틀을 쓴다.
 * 정답과 풀이는 코드가 계산한다(AI 가 아니라). 채점은 normalizeAnswer(친 글자) === expected.
 */

export interface Problem {
  /** calcItems.kind 에 들어간다. 제곱근 'sqrt' */
  kind: string;
  /** 한 줄 문제(기록용 글자). 제곱근 '√123456' */
  prompt: string;
  /** 여러 줄로 보여 줄 때(덧셈 세로셈). 없으면 prompt 한 줄 */
  lines?: string[];
  /** 정답 글자(정규형) */
  expected: string;
  /** 풀이 줄들(평문) — 틀렸을 때 붙잡힘 칸과 결과 화면에 보인다 */
  explain: string[];
}

/**
 * 친 답을 채점용 글자로. 공백·쉼표를 지우고, 정수부 앞의 불필요한 0 과 끝의 '.' 을 뗀다('0.xx' 의 0 은 둔다).
 * 소수 끝의 0 은 지우지 않는다 — 유효숫자라 '351.363060' 은 '351.36306' 과 다른 답이다.
 */
export function normalizeAnswer(s: string): string {
  return s.replace(/[\s,]/g, '').replace(/^(-?)0+(?=\d)/, '$1').replace(/\.$/, '');
}

/** 답 칸 글자 수 상한 — 28px 타자기 글씨가 휴대폰 기둥 한 줄에 드는 만큼 */
export const ANSWER_MAX = 18;

/** 답 칸에 한 글자(숫자·'.')를 더한 결과. 소수점은 하나만, 빈 답에서 '.' 은 '0.', 상한을 넘으면 그대로 */
export function appendAnswer(t: string, ch: string, max = ANSWER_MAX): string {
  if (t.length >= max) return t;
  if (ch === '.') return t.includes('.') ? t : t ? `${t}.` : '0.';
  return /^[0-9]$/.test(ch) ? t + ch : t;
}

/**
 * 문제 글자 크기(한 판 동안 하나로 고정) — 60px(l) 타자기 글씨는 8자까지 휴대폰 기둥에 들고, 넘으면 40px(m).
 * 여러 줄 문제는 가장 긴 줄로 잰다.
 */
export function promptSize(qs: Pick<Problem, 'prompt' | 'lines'>[]): 'l' | 'm' {
  const longest = Math.max(0, ...qs.flatMap((q) => (q.lines ?? [q.prompt]).map((l) => [...l].length)));
  return longest <= 8 ? 'l' : 'm';
}
