import { drillOutcome, type DrillRun } from '../db/drillOutcome';
import type { SessionSummary } from '../db/sessions';
import { compareBest, flapSec, NEAR_MISS, type RunOutcome } from '../lib/outcome';
import type { LevelStatus } from './calendarLadder';

/*
 * 달력 한 판의 결과 → 성적표(RunOutcome).
 * 연습은 기초 드릴과 같은 방식(db/drillOutcome): 신기록은 같은 칸의 지난 연습 중 10문항 이상·정확도 목표를 채운 판의
 * 평균 시간과 비교하고, 아까움은 nearRecordRt / nearAccuracyGoal. 목표 막대만 이 칸의 사다리 기준으로 바꾼다.
 * 모의 대회는 점수로: 같은 조건으로 끝까지 치른 지난 모의 대회의 최고보다 높으면 신기록. 첫 기록은 신기록이 아니다.
 */

export interface StepAvg { name: string; avgMs: number; n: number }

export function practiceOutcome({ run, status, past, steps = [] }: {
  run: DrillRun;
  /** 이번 판을 기록한 뒤의 이 칸 상태(이번 판 포함 최근 기록) */
  status: LevelStatus;
  /** 같은 칸·같은 단계 입력 설정의 지난 연습(이번 판 제외), 최근 것이 앞 */
  past: SessionSummary[];
  /** 단계 입력이면 단계별 평균(stepAverages) */
  steps?: StepAvg[];
}): RunOutcome {
  const o = drillOutcome({ run, past, goalAccuracy: status.level.pass?.accuracy ?? 0.95 });
  const slow = steps.reduce<StepAvg | null>((a, s) => (!a || s.avgMs > a.avgMs ? s : a), null);
  return { ...o, goals: status.bars, sage: slow && !o.record ? stepSage(slow) : o.sage };
}

/** 느린 단계마다 따로 다질 곳 */
const STEP_FIX: Record<string, string> = {
  '연도 코드': '연도 코드만 따로 다져 보세.',
  '월 코드': '월 코드만 따로 다져 보세.',
  '요일': '세 수를 더해 7로 나누는 셈만 따로 다져 보세.',
};

/** 스승님 한마디 — 가장 느린 단계를 실제 평균으로 짚는다 */
function stepSage(s: StepAvg): string {
  return `${s.name}에 평균 ${flapSec(s.avgMs)}초가 걸렸네. ${STEP_FIX[s.name] ?? '그 단계만 따로 다져 보세.'}`;
}

export interface ContestRun {
  correct: number;
  wrong: number;
  /** contestScore 로 낸 점수 */
  score: number;
  /** 문항당 평균 시간(ms) */
  perItemMs: number;
  limitSec: number;
}

export function contestOutcome({ run, past }: {
  run: ContestRun;
  /** 같은 조건(contestSessions)으로 끝까지 치른 지난 모의 대회 점수(이번 제외), 최근 것이 앞 */
  past: number[];
}): RunOutcome {
  const cmp = compareBest(past, run.score, 'higher');
  const record = cmp.isRecord ? { what: `점수 ${run.score}점` } : null;
  /* 최고와 같으면 모자란 것이 아니다. 0점이면 비교하지 않는다(compareBest) */
  const short = !record && cmp.gap > 0 && cmp.gap <= NEAR_MISS.items ? cmp.gap : 0;
  const last = past[0];
  return {
    stats: [
      { label: '점수', value: String(run.score), unit: '점', up: last != null && run.score > last ? `▲${run.score - last}` : undefined },
      { label: '정답 수', value: String(run.correct) },
      { label: '오답 수', value: String(run.wrong) },
      { label: '문항당 시간', value: flapSec(run.perItemMs), unit: '초' },
    ],
    goals: [],
    record,
    near: short ? [{ lead: '신기록까지', value: `${short}점` }] : [],
    sage: contestSage(run, !!record, short),
  };
}

/** 스승님 한마디(노교수 하게체). 숫자는 이 판의 실제 값만. */
function contestSage(r: ContestRun, record: boolean, short: number): string {
  const total = r.correct + r.wrong;
  if (!total) return `${r.limitSec}초 동안 한 문제도 풀지 못했군. 첫 날짜부터 차근차근 손을 대 보세.`;
  if (record) return `${r.score}점, 지금까지 가장 높네. 이 기록은 칠판 맨 위에 적어 두겠네.`;
  if (short) return `신기록까지 ${short}점이었네. 손이 풀린 지금 한 판 더 하게.`;
  if (r.wrong) return `${total}문제 중 ${r.wrong}문제를 틀렸네. 빠르기보다 한 문제씩 끝까지 셈해 보세.`;
  return `${r.limitSec}초에 ${r.correct}문제를 모두 맞혔네. 내일 다시 보세.`;
}
