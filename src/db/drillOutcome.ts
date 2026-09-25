import type { GoalStatus } from './goals';
import type { SessionSummary } from './sessions';
import {
  compareBest, flapClock, flapSec, nearAccuracyGoal, nearRecordRt,
  type NearLine, type OutcomeGoal, type RunOutcome,
} from '../lib/outcome';

/*
 * 기초 드릴(1·2·3단계) 한 판의 결과 → 성적표(RunOutcome).
 * 1·2단계(MappingDrill)와 3단계(Basics)가 같은 기준으로 결과를 내도록 한곳에 둔다.
 * 목표 막대는 db/goals.ts 의 단계 기준 그대로(새 채점 규칙을 만들지 않는다).
 * 신기록·아까움은 실제 기록으로만: 같은 단계의 지난 세션 중 정확도 목표를 채운 판의 평균 반응시간과 비교한다.
 */

/** 신기록 비교에 넣을 최소 문항 수 — 서너 문제짜리 판이 기록을 차지하지 않게 */
export const RECORD_MIN_ITEMS = 10;

export interface DrillRun {
  items: number;
  correct: number;
  /** 문항당 평균 반응시간(ms). 모름(Tab)처럼 잰 값이 없는 문항은 뺀 평균 */
  meanRtMs: number;
  maxStreak: number;
  /** 한 판에 실제로 쓴 시간(ms) */
  totalMs: number;
}

/** 목표 막대 셋: 반응 · 칸마다 n회 · 정확 — 단계 목표의 진행률 */
export function goalBars(g: GoalStatus): OutcomeGoal[] {
  const rt = g.medianRt > 0 ? Math.min(1, g.rule.rtMs / g.medianRt) : 0;
  const reps = g.total > 0 ? g.enough / g.total : 0;
  const acc = g.attempts > 0 ? Math.min(1, g.accuracy / g.rule.accuracy) : 0;
  return [
    { label: `반응 ${g.rule.rtMs / 1000}초`, ratio: rt, text: g.medianRt ? `${(g.medianRt / 1000).toFixed(2)}초` : '—', met: g.checks[2]?.ok ?? false },
    { label: `칸마다 ${g.rule.reps}회`, ratio: reps, text: g.total ? `${Math.round(reps * 100)}%` : '—', met: g.checks[0]?.ok ?? false },
    { label: `정확 ${Math.round(g.rule.accuracy * 100)}%`, ratio: acc, text: g.attempts ? `${Math.round(g.accuracy * 100)}%` : '—', met: g.checks[1]?.ok ?? false },
  ];
}

/** 신기록 비교에 들어갈 수 있는 판: 충분히 길고 정확도 목표를 채웠다 */
const eligible = (s: { items: number; correct: number }, goalAcc: number) =>
  s.items >= RECORD_MIN_ITEMS && s.correct / s.items >= goalAcc;

export function drillOutcome({ run, goal, past, goalAccuracy }: {
  run: DrillRun;
  /** 이 판을 기록한 뒤의 단계 목표 상태 */
  goal?: GoalStatus;
  /** 같은 단계의 지난 세션들(이번 판 제외), 최근 것이 앞 */
  past: SessionSummary[];
  /** 단계의 정확도 목표(0.95 등) */
  goalAccuracy: number;
}): RunOutcome {
  const acc = run.items ? run.correct / run.items : 0;
  const last = past[0];

  /* 지난번보다 나아진 것만 ▲ 로 */
  const accUp = last && Math.round(acc * 100) > Math.round(last.accuracy * 100) ? `▲${Math.round(acc * 100) - Math.round(last.accuracy * 100)}` : undefined;
  const rtGain = last && last.perItemMs > 0 && run.meanRtMs > 0 ? last.perItemMs - run.meanRtMs : 0;
  const rtUp = rtGain >= 10 ? `▲${(rtGain / 1000).toFixed(2)}` : undefined;

  const pastRts = past.filter((s) => eligible(s, goalAccuracy)).map((s) => s.perItemMs);
  const okNow = eligible(run, goalAccuracy) && run.meanRtMs > 0;
  const cmp = okNow ? compareBest(pastRts, run.meanRtMs, 'lower') : null;
  const record = cmp?.isRecord ? { what: `평균 반응시간 ${flapSec(run.meanRtMs)}초` } : null;

  const near: NearLine[] = [];
  if (!record) {
    const nr = okNow ? nearRecordRt(pastRts, run.meanRtMs) : null;
    if (nr) near.push(nr);
    const na = nearAccuracyGoal(run.correct, run.items, goalAccuracy);
    if (na) near.push(na);
  }

  return {
    stats: [
      { label: '정확도', value: String(Math.round(acc * 100)), unit: '%', up: accUp },
      { label: '평균 반응시간', value: flapSec(run.meanRtMs), unit: '초', up: rtUp },
      { label: '최대 연속', value: String(run.maxStreak) },
      { label: '걸린 시간', value: flapClock(run.totalMs) },
    ],
    goals: goal ? goalBars(goal) : [],
    record,
    near,
    sage: drillSage({ run, acc, record: !!record, near, rtGain, goalAccuracy }),
  };
}

/**
 * 스승님 한마디(규칙 코치) — 노교수 하게체. 숫자는 이 판의 실제 값만 인용한다.
 * 스승님(AI 코치)이 생기면 이 자리를 AI 문장으로 바꿀 수 있다. 제목·버튼은 평문으로 두고 여기만 하게체다.
 */
function drillSage({ run, acc, record, near, rtGain, goalAccuracy }: {
  run: DrillRun; acc: number; record: boolean; near: NearLine[]; rtGain: number; goalAccuracy: number;
}): string {
  if (!run.items) return '한 문제도 풀지 않았군. 다시 앉아 보세.';
  if (record) return `평균 ${flapSec(run.meanRtMs)}초, 지금까지 가장 빠르네. 이 기록은 칠판 맨 위에 적어 두겠네.`;
  const nr = near.find((n) => n.lead === '신기록까지');
  if (nr) return `${nr.value}라… 손이 풀린 지금이 기회일세. 한 판 더 하게.`;
  const na = near.find((n) => n.lead === '정확도 목표까지');
  if (na) return `${na.value}만 더 맞혔으면 목표였네. 한 판 더 하게.`;
  if (acc < goalAccuracy) return `정확도가 ${Math.round(acc * 100)}%일세. 서두르지 말고, 틀린 것부터 다시 보게.`;
  if (rtGain >= 10) return `지난번보다 평균이 ${(rtGain / 1000).toFixed(2)}초 빨라졌군. 이 흐름으로 가 보세.`;
  return `${run.items}문제를 ${Math.round(acc * 100)}%로 마쳤네. 내일 다시 보세.`;
}
