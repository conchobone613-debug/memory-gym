/*
 * 한 판의 결과 — 결과 화면(성적표)이 받는 값을 한곳에서 만든다.
 *
 * 신기록·아까움은 **실제 기록 값으로만** 판정한다. 지어내거나 부풀리면 회장이 보는 기록 자체가 거짓이 된다
 * (디자인 가이드 §3.7). 기준값은 NEAR_MISS 한 곳에 둔다.
 * 신기록 연출은 첫 기록일 때 하지 않는다 — 비교할 지난 기록이 있어야 신기록이다.
 */

/** 아까움 기준. 바꾸려면 여기만 고친다. */
export const NEAR_MISS = {
  /** 개인 최고 반응시간과 이만큼(ms) 이내로 느리면 아깝다 */
  rtMs: 100,
  /** 목표 정확도에 이 문항 수만큼 모자라면 아깝다 */
  items: 1,
  /** 최고 연속에 이만큼 모자라면 아깝다 */
  combo: 2,
};

export interface OutcomeStat {
  label: string;
  /** 글자판에 넘어갈 값(숫자와 . : 만) */
  value: string;
  unit?: string;
  /** 지난번보다 나아졌을 때만: '▲0.12' */
  up?: string;
}

export interface OutcomeGoal {
  /** 막대 왼쪽 짧은 이름(예: '반응 3초') */
  label: string;
  /** 0~1, 목표 대비. 1 = 채움 */
  ratio: number;
  /** 막대 오른쪽 수치(예: '96%') */
  text: string;
  met: boolean;
}

export interface NearLine {
  /** 앞말(예: '신기록까지') */
  lead: string;
  /** 실제 차이(예: '0.08초') — 빨간 타자기 글자 */
  value: string;
}

/** 결과 화면이 받는 전부. 화면마다 이것 하나를 만들어 <ResultSheet outcome> 에 넘긴다. */
export interface RunOutcome {
  stats: OutcomeStat[];
  goals: OutcomeGoal[];
  /** 신기록일 때만. what = 무엇이 신기록인지(평문, 예: '평균 반응시간 1.57초') */
  record?: { what: string } | null;
  near?: NearLine[];
  /** 스승님 한마디(노교수 하게체). 숫자는 이 결과의 실제 값만. */
  sage?: string;
}

export function outcomeTitle(o: RunOutcome): string {
  if (o.record) return '신기록입니다';
  if (o.near?.length) return '아깝습니다';
  return '공부를 마쳤습니다';
}

/** 금별 수 = 채운 목표 수(최대 3). 새 채점 규칙을 만들지 않는다. */
export const starsOf = (o: RunOutcome) => Math.min(3, o.goals.filter((g) => g.met).length);

/** 목표를 모두 채웠으면 '합격' 도장. 목표가 없으면 도장도 없다. */
export const passedOf = (o: RunOutcome) => o.goals.length > 0 && o.goals.every((g) => g.met);

/* ── 판정 도우미 (순수 함수) ───────────────────────── */

export type Better = 'lower' | 'higher';

/**
 * 지난 기록들과 비교. 지난 기록이 없으면 신기록이 아니다(첫 기록).
 * gap = 지금 값과 최고 사이 거리(항상 0 이상). 신기록이면 얼마나 앞섰는지, 아니면 얼마나 모자랐는지.
 */
export function compareBest(history: number[], current: number, better: Better): { isRecord: boolean; best: number | null; gap: number } {
  const valid = history.filter((x) => Number.isFinite(x) && x > 0);
  if (!valid.length || !(current > 0)) return { isRecord: false, best: valid.length ? pick(valid, better) : null, gap: 0 };
  const best = pick(valid, better);
  const isRecord = better === 'lower' ? current < best : current > best;
  return { isRecord, best, gap: Math.abs(current - best) };
}

const pick = (xs: number[], better: Better) => (better === 'lower' ? Math.min(...xs) : Math.max(...xs));

/** 반응시간 신기록에 NEAR_MISS.rtMs 이내로 못 미쳤는가 */
export function nearRecordRt(history: number[], currentMs: number): NearLine | null {
  const c = compareBest(history, currentMs, 'lower');
  if (c.best == null || c.isRecord || c.gap === 0 || c.gap > NEAR_MISS.rtMs) return null;
  return { lead: '신기록까지', value: `${(c.gap / 1000).toFixed(2)}초` };
}

/** 정확도 목표에 NEAR_MISS.items 문항 이내로 모자랐는가. goal = 0.95 같은 비율 */
export function nearAccuracyGoal(correct: number, total: number, goal: number): NearLine | null {
  if (total <= 0) return null;
  const need = Math.ceil(goal * total - 1e-9);
  const short = need - correct;
  if (short <= 0 || short > NEAR_MISS.items) return null;
  return { lead: '정확도 목표까지', value: `${short}문제` };
}

/** 최고 연속에 NEAR_MISS.combo 이내로 모자랐는가 */
export function nearCombo(historyMax: number[], maxCombo: number): NearLine | null {
  const best = Math.max(0, ...historyMax);
  const short = best - maxCombo;
  if (best <= 0 || short <= 0 || short > NEAR_MISS.combo) return null;
  return { lead: '최고 연속까지', value: `${short}번` };
}

/** 글자판용 숫자 모양 */
export const flapSec = (ms: number) => (ms > 0 ? (ms / 1000).toFixed(2) : '0.00');
export const flapClock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
