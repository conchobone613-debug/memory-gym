import { db } from './db';
import { allUnits, type Stage } from '../lib/mapping';
import { median } from '../lib/srs';

export type AnyStage = Stage | 3;

export interface GoalCheck {
  label: string;
  ok: boolean;
  /** 지금 어디까지 왔는지 */
  detail: string;
}

export interface GoalStatus {
  stage: AnyStage;
  attempts: number;
  accuracy: number;
  medianRt: number;
  /** 아직 한 번도 안 본 칸 */
  unseen: number;
  checks: GoalCheck[];
  passed: boolean;
  /** 통과하면 무엇으로 넘어가는지 */
  next: string;
  /** 이 단계의 기준값 (결과 화면 목표 막대가 이 값을 그대로 쓴다) */
  rule: { reps: number; accuracy: number; rtMs: number };
  /** reps 이상 본 칸 / 전체 칸 */
  enough: number;
  total: number;
}

/**
 * 단계별 통과 기준.
 * 반복 횟수는 '한 번 맞혔다'와 '붙었다'를 구분하려고 둔다. 반응시간 기준은 단계가 하는 일에
 * 비례한다 — 2단계는 조회를 두 번 하므로 1단계의 두 배로 잡는다.
 */
const RULES: Record<AnyStage, { reps: number; accuracy: number; rtMs: number; next: string }> = {
  1: { reps: 3, accuracy: 0.95, rtMs: 1500, next: '2단계 · 자음 두 개' },
  2: { reps: 3, accuracy: 0.95, rtMs: 3000, next: '3단계 · 이미지 변환' },
  3: { reps: 3, accuracy: 0.95, rtMs: 3000, next: '종목 · 모의 대회' },
};

/*
 * 사다리 — 종목마다 부하가 커지는 단계 목록 (기획서 §6.6).
 * 사다리와 통과 기준은 코드가 정하고, 스승님은 그 위에서 오늘 할 칸을 고른다.
 * 기초 세 단계가 첫 사다리다. 종목을 만들 때마다 여기에 사다리를 더한다.
 */
export interface LadderLevel {
  id: string;
  name: string;
  to: string;
  stage: AnyStage;
}

export interface Ladder {
  id: string;
  name: string;
  levels: LadderLevel[];
}

export const LADDERS: Ladder[] = [
  {
    id: 'basics',
    name: '기초',
    levels: [
      { id: 'basics-1', name: '자음 하나', to: '/basics?stage=1', stage: 1 },
      { id: 'basics-2', name: '두 자리', to: '/basics?stage=2', stage: 2 },
      { id: 'basics-3', name: '이미지', to: '/basics?stage=3', stage: 3 },
    ],
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (ms: number) => (ms ? `${(ms / 1000).toFixed(2)}초` : '—');

export async function goalFor(stage: AnyStage): Promise<GoalStatus> {
  const rule = RULES[stage];

  let attempts = 0;
  let correct = 0;
  let rts: number[] = [];
  let total = 0;
  let enough = 0; // reps 이상 본 칸
  let unseen = 0;

  if (stage === 3) {
    /* 3단계 기준은 '이름을 채운 이미지' 전부다. 빈 칸은 애초에 출제되지 않는다. */
    const named = await db.images.filter((i) => !!i.name.trim()).toArray();
    const ids = new Set(named.map((i) => i.id));
    const stats = (await db.imageStats.toArray()).filter((s) => ids.has(s.imageId));
    total = named.length;
    attempts = stats.reduce((a, s) => a + s.attempts, 0);
    correct = stats.reduce((a, s) => a + s.correct, 0);
    rts = stats.filter((s) => s.rtSamples.length > 0).map((s) => s.medianRt);
    enough = stats.filter((s) => s.attempts >= rule.reps).length;
    unseen = total - stats.filter((s) => s.attempts > 0).length;
  } else {
    const units = allUnits(stage);
    const stats = await db.mappingStats.where('stage').equals(stage).toArray();
    total = units.length;
    attempts = stats.reduce((a, s) => a + s.attempts, 0);
    correct = stats.reduce((a, s) => a + s.correct, 0);
    rts = stats.filter((s) => s.rtSamples.length > 0).map((s) => s.medianRt);
    enough = stats.filter((s) => s.attempts >= rule.reps).length;
    unseen = total - stats.filter((s) => s.attempts > 0).length;
  }

  const accuracy = attempts ? correct / attempts : 0;
  const medianRt = Math.round(median(rts));

  const checks: GoalCheck[] = [
    {
      label: `모든 칸을 ${rule.reps}번 이상`,
      ok: total > 0 && enough >= total,
      detail: total ? `${enough} / ${total}칸` : '칸이 없습니다',
    },
    {
      label: `정확도 ${pct(rule.accuracy)} 이상`,
      ok: attempts > 0 && accuracy >= rule.accuracy,
      detail: attempts ? `지금 ${pct(accuracy)}` : '아직 기록 없음',
    },
    {
      label: `중앙 반응시간 ${sec(rule.rtMs)} 이하`,
      ok: medianRt > 0 && medianRt <= rule.rtMs,
      detail: medianRt ? `지금 ${sec(medianRt)}` : '아직 기록 없음',
    },
  ];

  return {
    stage, attempts, accuracy, medianRt, unseen,
    checks,
    passed: checks.every((c) => c.ok),
    next: rule.next,
    rule: { reps: rule.reps, accuracy: rule.accuracy, rtMs: rule.rtMs },
    enough, total,
  };
}
