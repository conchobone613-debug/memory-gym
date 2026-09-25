import { db, type RuleValues } from '../db/db';
import type { CalcEvent, RuleField } from '../data/events';

/** 등록부의 기본값. 저장된 규정이 없을 때 쓴다. */
export function defaultRules(fields: RuleField[]): RuleValues {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

/**
 * 값 하나를 칸 규칙에 맞춘다. 범위 밖 숫자는 끝값으로, 모르는 선택지는 기본값으로.
 * 설정 화면의 입력과 저장된 옛 값이 같은 길을 지난다.
 */
export function clampRule(f: RuleField, v: unknown): number | string {
  if (f.kind === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return f.default;
    return Math.min(f.max, Math.max(f.min, Math.round(n)));
  }
  return f.options.some((o) => o.value === v) ? (v as string) : f.default;
}

/**
 * 저장된 값을 기본값 위에 덮는다. 나중에 칸이 늘어도 옛 규정에 구멍이 나지 않고,
 * 칸이 없어지면 그 값은 조용히 빠진다.
 */
export function mergeRules(fields: RuleField[], stored?: RuleValues): RuleValues {
  return Object.fromEntries(fields.map((f) => [f.key, stored && f.key in stored ? clampRule(f, stored[f.key]) : f.default]));
}

const rulesetId = (disciplineId: string) => `${disciplineId}:default`;

export async function getRules(ev: CalcEvent): Promise<RuleValues> {
  const row = await db.rulesets.get(rulesetId(ev.id));
  return mergeRules(ev.rules, row?.values);
}

export async function saveRules(ev: CalcEvent, values: RuleValues): Promise<void> {
  await db.rulesets.put({
    id: rulesetId(ev.id),
    disciplineId: ev.id,
    name: '내 규정',
    values: mergeRules(ev.rules, values),
    isDefault: true,
    updatedAt: Date.now(),
  });
}

export async function resetRules(ev: CalcEvent): Promise<void> {
  await db.rulesets.delete(rulesetId(ev.id));
}
