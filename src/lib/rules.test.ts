import { describe, expect, it } from 'vitest';
import type { RuleField } from '../data/events';
import { clampRule, defaultRules, mergeRules } from './rules';

const FIELDS: RuleField[] = [
  { key: 'items', label: '문항 수', kind: 'number', default: 10, min: 1, max: 100 },
  { key: 'rounding', label: '끝자리', kind: 'choice', default: 'trunc', options: [{ value: 'trunc', label: '버림' }, { value: 'round', label: '반올림' }] },
];

describe('규정 값', () => {
  it('저장된 것이 없으면 기본값', () => {
    expect(mergeRules(FIELDS)).toEqual(defaultRules(FIELDS));
  });

  it('범위 밖 숫자는 끝값으로, 모르는 선택지는 기본값으로', () => {
    expect(clampRule(FIELDS[0], 500)).toBe(100);
    expect(clampRule(FIELDS[0], -3)).toBe(1);
    expect(clampRule(FIELDS[0], '12')).toBe(12);
    expect(clampRule(FIELDS[0], 'abc')).toBe(10);
    expect(clampRule(FIELDS[1], 'ceil')).toBe('trunc');
  });

  it('칸이 늘면 기본값으로 채우고, 없어진 칸은 버린다', () => {
    expect(mergeRules(FIELDS, { items: 20, gone: 1 })).toEqual({ items: 20, rounding: 'trunc' });
  });
});
