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

export interface PromptLayout {
  /** 문제 카드 크기 등급(promptSize) */
  size: 'l' | 'm';
  /** 세로셈 문항의 글자 크기·촘촘한 배치 — 세로셈 문항만으로 잰 stackLayout. 세로셈이 없으면 null */
  stack: { px: number; compact: boolean } | null;
  /** 한 줄 문제 글자 크기(px) — 등급 글자(60·40px)가 카드 안쪽 폭이나 이 배치의 문제 칸 높이를 넘을 때만. 아니면 null */
  linePx: number | null;
  /** 이 판에서 가장 높은 문제 칸(px) — 칸을 이 높이로 두면 섞인 판에서도 문항마다 카드 크기가 같다 */
  boxPx: number;
}

/**
 * 한 판의 문제 배치(한 판 동안 고정) — 세로셈과 한 줄 문제가 섞인 판(서프라이즈 섞기)도 판 전체 문항으로 한 번에 정한다.
 * 세로셈은 세로셈 문항만으로 잰다(긴 한 줄 식이 세로셈 글자를 줄이지 않게). 한 줄 문제는 그 배치(촘촘 여부)에서
 * 카드 폭과 문제 칸 높이에 들도록 줄인다. 세로셈만 있는 판은 stackLayout 그대로다.
 */
export function promptLayout(qs: Pick<Problem, 'prompt' | 'lines'>[], viewH: number, viewW = 375): PromptLayout {
  const size = promptSize(qs);
  const stacked = qs.filter((q) => q.lines);
  const single = qs.filter((q) => !q.lines);
  const stack = stacked.length ? stackLayout(stacked, viewH, viewW) : null;
  const room = viewH - STACK_CHROME[stack?.compact ? 'compact' : 'normal'];
  const chars = Math.max(1, ...single.map((q) => [...q.prompt].length));
  const fit = Math.max(STACK_MIN_PX, Math.floor(Math.min(PROMPT_PX[size], fitWidth(chars, viewW), room)));
  const linePx = single.length && fit < PROMPT_PX[size] ? fit : null;
  const rows = Math.max(0, ...stacked.map((q) => q.lines!.length));
  const boxPx = Math.max(stack ? rows * stack.px * STACK_LH : 0, single.length ? (linePx ?? PROMPT_PX[size]) : 0);
  return { size, stack, linePx, boxPx };
}

/** 곱셈 세로셈(마지막 줄 '× 755') — 밑줄을 긋는다. 밑줄은 2px 선 + 여백으로 4px */
export const ruled = (q: Pick<Problem, 'lines'>) => !!q.lines?.at(-1)?.startsWith('×');
const RULE_PX = 4;

/**
 * 실행기 문제 칸의 고정 높이(px) — 문항마다 칸 높이가 달라지는 판만: 한 줄 문제와 세로셈이 섞였거나, 세로셈의 줄 수·밑줄이
 * 문항마다 다른 판(서프라이즈 3×3 곱셈 + 덧셈 열 줄). 모든 문항 높이가 같은 판(기존 종목)은 null — 칸을 고정하지 않는다.
 */
export function promptBoxPx(qs: Pick<Problem, 'prompt' | 'lines'>[], lay: PromptLayout): number | null {
  const varies = qs.some((q) => !q.lines)
    || new Set(qs.map((q) => q.lines?.length ?? 0)).size > 1
    || new Set(qs.map(ruled)).size > 1;
  return lay.stack && varies ? Math.ceil(lay.boxPx) + (qs.some(ruled) ? RULE_PX : 0) : null;
}

/** 플래시 칸 글자 크기(px) — 한 번에 수 하나라 가장 긴 수가 카드 폭(기둥 폭 viewW)에 드는 크기, 60px 까지 */
export function flashFontPx(qs: Pick<Problem, 'prompt' | 'lines'>[], viewW = 375): number {
  const chars = Math.max(1, ...qs.flatMap((q) => (q.lines ?? [q.prompt]).map((l) => [...l].length)));
  return Math.floor(Math.min(PROMPT_PX.l, fitWidth(chars, viewW)));
}
