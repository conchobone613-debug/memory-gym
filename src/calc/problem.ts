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

/** 답 칸 글자 수 상한의 기본(최소)값 — 28px 타자기 글씨가 휴대폰 기둥 한 줄에 드는 만큼. 한 판의 상한은 answerMax */
export const ANSWER_MAX = 18;

const longestExpected = (qs: Pick<Problem, 'expected'>[]) => Math.max(0, ...qs.map((q) => q.expected.length));

/** 한 판의 답 칸 상한 — 가장 긴 정답 + 2(18~30). 곱셈 12×12 는 24자리라 18 로는 못 친다 */
export const answerMax = (qs: Pick<Problem, 'expected'>[]) => Math.min(30, Math.max(ANSWER_MAX, longestExpected(qs) + 2));

/**
 * 답 칸 글자 크기(한 판 동안 하나로 고정) — 가장 긴 정답이 16자 이하면 28px(l), 넘으면 20px(m).
 * 375px 기둥 − 여백 14·2 − 답 칸 12·2 − 커서 5 = 318px, Courier Prime 한 글자 0.6em → 28px 18자 302px · 20px 26자 312px.
 */
export const answerSize = (qs: Pick<Problem, 'expected'>[]): 'l' | 'm' => (longestExpected(qs) <= 16 ? 'l' : 'm');

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

/**
 * 한 줄이 문제 카드 안쪽 폭(기둥 폭 − 여백 14·2 − 카드 12·2, 375px 휴대폰이면 323px)에 드는 가장 큰 글자 크기
 * — Courier Prime 한 글자 0.6em + 자간 .02em
 */
const fitWidth = (chars: number, viewW: number) => (viewW - 52) / (Math.max(1, chars) * 0.62);
const PROMPT_PX = { l: 60, m: 40 } as const;

/** 세로셈 줄 높이(글자 크기 대비) — 숫자는 아래로 내려가는 획이 없어 1 보다 좁혀도 줄이 닿지 않는다 */
export const STACK_LH = 0.9;

/*
 * 측정 화면(연습)에서 문제 줄을 뺀 높이(px). 보통: 위 여백 16 + 시계·중단 줄 30 + 머리띠 74 + 카드 둘레 83
 * + 답 칸 56 + 자판 267 + 틈 12×4 + 곱셈 밑줄 4 = 578. 촘촘: 카드 둘레 57 + 답 칸 48 + 자판(키 40px) 243 + 틈 8×4 = 504.
 */
export const STACK_CHROME = { normal: 578, compact: 504 } as const;
/** 보통 배치로 이보다 작아지면 촘촘한 배치로 — 답 칸 글자(28px)보다 작은 문제 글자는 읽기 어렵다 */
const COMPACT_BELOW = 28;
const STACK_MIN_PX = 16;

/**
 * 세로셈(여러 줄 문제) 배치 — 한 판 동안 고정. 글자는 promptSize 크기에서 시작해 가장 긴 줄이 카드 폭(기둥 폭 viewW)에,
 * 줄 수 × 줄 높이가 보이는 높이(viewH)에서 둘레를 뺀 만큼에 들도록 줄인다. 보통 배치로 28px 밑이면 자판·틈을 줄인
 * 촘촘한 배치로 다시 잰다. 16px 밑으로는 줄이지 않는다(규정 끝값처럼 줄이 아주 많으면 화면이 조금 밀린다).
 */
export function stackLayout(qs: Pick<Problem, 'prompt' | 'lines'>[], viewH: number, viewW = 375): { px: number; compact: boolean } {
  const rows = Math.max(1, ...qs.map((q) => (q.lines ?? [q.prompt]).length));
  const chars = Math.max(1, ...qs.flatMap((q) => (q.lines ?? [q.prompt]).map((l) => [...l].length)));
  const px = (chrome: number) =>
    Math.max(STACK_MIN_PX, Math.floor(Math.min(PROMPT_PX[promptSize(qs)], fitWidth(chars, viewW), (viewH - chrome) / (rows * STACK_LH))));
  const normal = px(STACK_CHROME.normal);
  return normal >= COMPACT_BELOW ? { px: normal, compact: false } : { px: px(STACK_CHROME.compact), compact: true };
}

/** 플래시 칸 글자 크기(px) — 한 번에 수 하나라 가장 긴 수가 카드 폭(기둥 폭 viewW)에 드는 크기, 60px 까지 */
export function flashFontPx(qs: Pick<Problem, 'prompt' | 'lines'>[], viewW = 375): number {
  const chars = Math.max(1, ...qs.flatMap((q) => (q.lines ?? [q.prompt]).map((l) => [...l].length)));
  return Math.floor(Math.min(PROMPT_PX.l, fitWidth(chars, viewW)));
}
