import type { CalcEvent } from '../data/events';
import type { CalcSession, RuleValues } from '../db/db';
import type { CalcLog } from '../db/calcLog';
import { drillOutcome, type DrillRun } from '../db/drillOutcome';
import type { SessionSummary } from '../db/sessions';
import { mergeRules } from '../lib/rules';
import { flapClock, NEAR_MISS, type NearLine, type RunOutcome } from '../lib/outcome';
import type { CalcLevelStatus } from './ladders';

export { contestScore } from './calendarDrill';

/*
 * 계산 종목(달력 제외) 한 판의 결과 → 성적표(RunOutcome).
 * 연습은 기초 드릴과 같은 방식(db/drillOutcome)에 목표 막대만 그 칸의 사다리 기준.
 * 모의 대회는 같은 규정으로 끝까지 치른 판끼리: 점수가 높은 쪽, 같으면 걸린 시간이 짧은 쪽이 앞선다(시간 제한 없는 규정).
 * 첫 기록은 신기록이 아니다. 숫자는 이 판의 실제 값만.
 */

/** 같은 규정인가 — 등록부의 규정 칸 전부(문항 수·제한시간·감점·종목별 칸). 나중에 생긴 칸은 기본값으로 본다 */
export function sameRules(ev: CalcEvent, a: RuleValues, b: RuleValues): boolean {
  const x = mergeRules(ev.rules, a);
  const y = mergeRules(ev.rules, b);
  return ev.rules.every((f) => x[f.key] === y[f.key]);
}

/** 같은 규정으로 끝까지 치른 모의 대회(취소한 판은 endedAt 이 없다), 최근 것이 앞 */
export function calcContestSessions(log: CalcLog, ev: CalcEvent, rules: RuleValues): CalcSession[] {
  return log.sessions
    .filter((s) => s.disciplineId === ev.id && s.mode === 'contest' && !!s.endedAt && sameRules(ev, s.rules, rules))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** 모의 대회 한 판에 걸린 시간 — 지난 판과 이번 판을 같은 잣대(세션 endedAt − startedAt)로 잰다 */
export const contestTimeMs = (s: Pick<CalcSession, 'startedAt' | 'endedAt'>) => Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt);

/** '4분 12초' · '52초' */
export function clockKo(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m ? (s ? `${m}분 ${s}초` : `${m}분`) : `${s}초`;
}

export function calcPracticeOutcome({ run, status, past }: {
  run: DrillRun;
  /** 이번 판을 기록한 뒤의 이 칸 상태(evalCalcLevel) */
  status: CalcLevelStatus;
  /** 같은 칸의 지난 연습(이번 판 제외), 최근 것이 앞 */
  past: SessionSummary[];
}): RunOutcome {
  return { ...drillOutcome({ run, past, goalAccuracy: status.level.pass?.accuracy ?? 0.9 }), goals: status.bars };
}

export interface CalcContestRun {
  /** 규정 문항 수 */
  items: number;
  correct: number;
  wrong: number;
  /** contestScore 로 낸 점수 */
  score: number;
  /** 걸린 시간(ms) = 이 세션의 endedAt − startedAt(contestTimeMs) */
  totalMs: number;
  /** 규정 제한시간(초). 0 = 시간 제한 없음 */
  limitSec: number;
}

/** 틀린 문제에서 다시 볼 곳(종목별). 없으면 '풀이' */
const FIX: Record<string, string> = { sqrt: '정밀화 단계' };

export function calcContestOutcome({ eventId, run, past }: {
  eventId: string;
  run: CalcContestRun;
  /** 같은 규정으로 끝까지 치른 지난 모의 대회(calcContestSessions, 이번 제외), 최근 것이 앞 */
  past: Pick<CalcSession, 'score' | 'startedAt' | 'endedAt'>[];
}): RunOutcome {
  /* 제한시간이 있으면 시간을 제한시간에서 자른다 — 시간이 다 되어 끝난 판끼리는 시계 간격·저장 지연만큼의 차이라 겨루지 않는다 */
  const cap = run.limitSec > 0 ? run.limitSec * 1000 : Infinity;
  const runMs = Math.min(run.totalMs, cap);
  /* 0점 판은 겨루지 않는다(compareBest 와 같은 규칙) */
  const hist = past.filter((s) => s.endedAt && s.score > 0).map((s) => ({ score: s.score, ms: Math.min(contestTimeMs(s), cap) }));
  const best = hist.reduce<{ score: number; ms: number } | null>(
    (b, h) => (!b || h.score > b.score || (h.score === b.score && h.ms < b.ms) ? h : b), null);
  const isRecord = !!best && run.score > 0 && (run.score > best.score || (run.score === best.score && runMs < best.ms));
  const record = !isRecord ? null
    : run.score > best!.score ? { what: `점수 ${run.score}점` } : { what: `${run.score}점 · ${clockKo(runMs)}` };

  const near: NearLine[] = [];
  const gap = best ? best.score - run.score : 0;
  const late = best && gap === 0 ? runMs - best.ms : 0;
  if (!record && best && run.score > 0) {
    if (gap > 0 && gap <= NEAR_MISS.items) near.push({ lead: '신기록까지', value: `${gap}점` });
    else if (late > 0 && late <= NEAR_MISS.contestMs) near.push({ lead: '신기록까지', value: `${(late / 1000).toFixed(1)}초` });
  }

  const last = past[0];
  return {
    stats: [
      { label: '점수', value: String(run.score), unit: '점', up: last && run.score > last.score ? `▲${run.score - last.score}` : undefined },
      { label: '정답 수', value: String(run.correct) },
      { label: '오답 수', value: String(run.wrong) },
      { label: '걸린 시간', value: flapClock(run.totalMs) },
    ],
    goals: [],
    record,
    near,
    sage: contestSage(eventId, run, !!record, near[0]),
  };
}

/** 스승님 한마디(노교수 하게체). 숫자는 이 판의 실제 값만 */
function contestSage(eventId: string, r: CalcContestRun, record: boolean, near?: NearLine): string {
  const answered = r.correct + r.wrong;
  const clock = clockKo(r.totalMs);
  if (!answered) return '한 문제도 풀지 못했군. 첫 문제부터 차근차근 손을 대 보세.';
  if (record) return `${r.score}점을 ${clock}에 냈네. 지금까지 가장 좋은 기록이니 칠판 맨 위에 적어 두겠네.`;
  if (near?.value.endsWith('점')) return `신기록까지 ${near.value}이었네. 손이 풀린 지금 한 판 더 하게.`;
  if (near) return `같은 점수에서 ${near.value} 늦었네. 손이 풀린 지금 한 판 더 하게.`;
  if (answered < r.items) return `${r.items}문제 중 ${answered}문제를 ${clock}에 풀었네. 시간 안에 끝까지 가는 것부터 다져 보세.`;
  if (r.wrong) return `${r.items}문제 중 ${r.correct}문제, ${clock}일세. 틀린 ${r.wrong}문제의 ${FIX[eventId] ?? '풀이'}를 다시 보게.`;
  return `${r.items}문제를 모두 맞혔네, ${clock}일세. 내일 다시 보세.`;
}
