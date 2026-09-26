import type { RecallSession } from '../db/db';
import { compareBest, flapClock, NEAR_MISS, type RunOutcome } from './outcome';

/*
 * 대회식 점수가 있는 종목(듣기·이진수)의 성적표. 첫 수치가 대회 점수이고, 신기록·아까움도 그 점수로만 가린다.
 * 글자판은 넷까지라 맞힌 칸은 성적표 아래 채점 상세에 둔다.
 */

export type ScoredKind = 'spoken' | 'binary';

/**
 * 비교할 지난 판의 점수(최근 것이 앞) — 같은 프리셋·같은 모드·같은 칸 수, 듣기는 같은 낭독 간격, 점수가 있는 판만.
 * runMode 가 없는 옛 기록은 규격대로 한 판으로 본다.
 */
export function scoredHistory(
  sessions: RecallSession[],
  cur: { id: string; presetName: string; runMode: 'easy' | 'real'; total: number; intervalMs?: number },
): number[] {
  return sessions
    .filter((s) => s.id !== cur.id && s.score !== undefined && s.presetName === cur.presetName
      && (s.runMode ?? 'real') === cur.runMode && s.correct + s.wrong + s.blank === cur.total
      && (cur.intervalMs === undefined || s.params?.intervalMs === cur.intervalMs))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => s.score!);
}

export function scoredOutcome({ kind, score, max, correct, total, memorizeUsedMs, recallUsedMs, past }: {
  kind: ScoredKind;
  /** 대회 점수 — 듣기는 처음 틀린 곳까지 자리 수, 이진수는 줄 점수 */
  score: number;
  /** 만점(출제 자리 수) */
  max: number;
  /** 맞힌 칸 · 전체 칸 */
  correct: number;
  total: number;
  memorizeUsedMs: number;
  recallUsedMs: number;
  /** scoredHistory 의 결과(최근 것이 앞) */
  past: number[];
}): RunOutcome {
  const spoken = kind === 'spoken';
  const unit = spoken ? '자리' : '점';
  const cmp = compareBest(past, score, 'higher');
  const record = cmp.isRecord ? { what: spoken ? `처음 틀린 곳까지 ${score}자리` : `줄 점수 ${score}점` } : null;
  const limit = spoken ? NEAR_MISS.spokenDigits : NEAR_MISS.binaryPoints;
  const nearGap = !record && cmp.gap > 0 && cmp.gap <= limit ? cmp.gap : 0;
  const last = past[0];
  return {
    stats: [
      {
        label: spoken ? '처음 틀린 곳까지' : '줄 점수', value: String(score), unit: spoken ? '자리' : `/${max}`,
        up: last !== undefined && score > last ? `▲${score - last}` : undefined,
      },
      { label: '정확도', value: String(Math.round((total ? correct / total : 0) * 100)), unit: '%' },
      { label: spoken ? '낭독' : '암기 사용', value: flapClock(memorizeUsedMs) },
      { label: '회상 사용', value: flapClock(recallUsedMs) },
    ],
    goals: [],
    record,
    near: nearGap ? [{ lead: '신기록까지', value: `${nearGap}${unit}` }] : [],
    sage: spoken ? spokenSage(score, max, !!record, nearGap) : binarySage(score, max, !!record, nearGap),
  };
}

/** 스승님 한마디(규칙 코치) — 노교수 하게체. 숫자는 이 판의 실제 값만. */
function spokenSage(score: number, max: number, record: boolean, nearGap: number): string {
  if (!score) return `${max}자리 중 첫 자리부터 놓쳤군. 처음 몇 자리를 붙드는 데만 마음을 두게.`;
  if (record) return `처음 틀린 곳까지 ${score}자리, 지금까지 가장 길었네. 칠판 맨 위에 적어 두겠네.`;
  if (nearGap) return `신기록까지 ${nearGap}자리였네. 귀가 열린 지금 한 판 더 하게.`;
  if (score === max) return `${max}자리를 끝까지 맞혔네. 다음엔 분량을 늘려 보세.`;
  return `${max}자리 중 처음 틀린 곳까지 ${score}자리일세. 틀린 자리 앞뒤를 다시 들어 보게.`;
}

function binarySage(score: number, max: number, record: boolean, nearGap: number): string {
  if (!score) return '줄 점수가 0점일세. 한 줄에 둘 이상 틀리면 그 줄은 0점이니 분량을 줄여 보세.';
  if (record) return `줄 점수 ${score}점, 지금까지 가장 높네. 칠판 맨 위에 적어 두겠네.`;
  if (nearGap) return `신기록까지 ${nearGap}점이었네. 손이 풀린 지금 한 판 더 하게.`;
  if (score === max) return `${max}점 만점일세. 다음엔 분량을 늘려 보세.`;
  return `줄 점수 ${score}점일세. 한 줄에 한 자리만 틀려도 반이 깎이니 줄 끝을 다시 보게.`;
}
