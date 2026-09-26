import { describe, expect, it } from 'vitest';
import { ANSWER_MAX, appendAnswer, normalizeAnswer, promptSize } from './problem';
import { CALC_MAKERS } from './makers';
import { calcLevels } from './ladders';
import { seeded } from './rng';

const typeAll = (keys: string[]) => keys.reduce((t, k) => appendAnswer(t, k), '');

describe('답 칸 입력(appendAnswer)', () => {
  it('숫자를 차례로 붙인다', () => {
    expect(typeAll(['3', '5', '1', '.', '3', '6'])).toBe('351.36');
  });

  it("소수점은 하나만, 빈 답에서 '.' 은 '0.'", () => {
    expect(appendAnswer('', '.')).toBe('0.');
    expect(appendAnswer('3.1', '.')).toBe('3.1');
    expect(typeAll(['.', '5'])).toBe('0.5');
    expect(normalizeAnswer(typeAll(['.', '5']))).toBe('0.5');
  });

  it('상한을 넘거나 숫자·소수점이 아닌 글자는 받지 않는다', () => {
    const full = '1'.repeat(ANSWER_MAX);
    expect(appendAnswer(full, '2')).toBe(full);
    expect(appendAnswer(full, '.')).toBe(full);
    expect(appendAnswer('12', 'a')).toBe('12');
    expect(appendAnswer('12', '-')).toBe('12');
  });
});

describe('문제 글자 크기(promptSize)', () => {
  it('8자까지는 l, 넘으면 m — 여러 줄은 가장 긴 줄로', () => {
    expect(promptSize([{ prompt: '√123456' }])).toBe('l');
    expect(promptSize([{ prompt: '√1234567' }])).toBe('l');
    expect(promptSize([{ prompt: '√12345678' }])).toBe('m');
    expect(promptSize([{ prompt: '합', lines: ['12345', '123456789'] }])).toBe('m');
  });

  it('제곱근 기본 규정(6자리)은 l, 규정 끝값(12자리)은 m', () => {
    const r = seeded('size');
    const six = Array.from({ length: 20 }, () => CALC_MAKERS.sqrt.make(r, { digits: 6, sig: 8, rounding: 'trunc' }));
    const twelve = Array.from({ length: 20 }, () => CALC_MAKERS.sqrt.make(r, { digits: 12, sig: 12, rounding: 'trunc' }));
    expect(promptSize(six)).toBe('l');
    expect(promptSize(twelve)).toBe('m');
  });
});

describe('제곱근 문항 만들기(CALC_MAKERS.sqrt)', () => {
  const rules = { items: 10, timeLimitSec: 0, penaltyPerWrong: 0, digits: 6, sigDigits: 8, rounding: 'round' };
  const [l1, , , contest] = calcLevels('sqrt');

  it('연습 칸은 칸의 자릿수·유효숫자, 끝자리는 규정을 따른다', () => {
    expect(CALC_MAKERS.sqrt.params(rules, l1)).toEqual({ digits: 4, sig: 4, rounding: 'round' });
  });

  it('모의 대회 칸은 규정 그대로', () => {
    expect(CALC_MAKERS.sqrt.params(rules, contest)).toEqual({ digits: 6, sig: 8, rounding: 'round' });
  });

  it('답 조건 한 줄', () => {
    expect(CALC_MAKERS.sqrt.ask({ digits: 6, sig: 8, rounding: 'trunc' })).toBe('유효숫자 8자리 · 버림');
    expect(CALC_MAKERS.sqrt.ask({ digits: 4, sig: 4, rounding: 'round' })).toBe('유효숫자 4자리 · 반올림');
  });

  it('칸 설정으로 만든 문제의 정답은 자판으로 칠 수 있는 글자다', () => {
    const r = seeded('pad');
    for (let i = 0; i < 200; i++) {
      const q = CALC_MAKERS.sqrt.make(r, CALC_MAKERS.sqrt.params(rules, contest));
      expect(normalizeAnswer(typeAll([...q.expected]))).toBe(q.expected);
    }
  });
});
