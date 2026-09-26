import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX, answerMax, answerSize, appendAnswer, flashFontPx, normalizeAnswer, promptSize, STACK_CHROME, STACK_LH, stackLayout,
} from './problem';
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

describe('답 칸 상한·글자 크기(answerMax · answerSize) — 한 판 단위', () => {
  const e = (...lens: number[]) => lens.map((n) => ({ expected: '9'.repeat(n) }));

  it('상한 = 가장 긴 정답 + 2, 18~30', () => {
    expect(answerMax(e(3, 5))).toBe(ANSWER_MAX);
    expect(answerMax(e(16))).toBe(18);
    expect(answerMax(e(17, 2))).toBe(19);
    expect(answerMax(e(24))).toBe(26);
    expect(answerMax(e(40))).toBe(30);
    expect(answerMax([])).toBe(ANSWER_MAX);
  });

  it('16자까지는 l(28px), 넘으면 m(20px)', () => {
    expect(answerSize(e(16, 3))).toBe('l');
    expect(answerSize(e(17))).toBe('m');
    expect(answerSize([])).toBe('l');
  });

  it('제곱근은 규정 끝값에서도 그대로(18 · l), 곱셈 12×12 는 24자리를 칠 수 있다', () => {
    const r = seeded('max');
    const sq = Array.from({ length: 50 }, () => CALC_MAKERS.sqrt.make(r, { digits: 12, sig: 12, rounding: 'round' }));
    expect(answerMax(sq)).toBe(ANSWER_MAX);
    expect(answerSize(sq)).toBe('l');
    const big = Array.from({ length: 50 }, () => CALC_MAKERS.multiplication.make(r, { digitsA: 12, digitsB: 12 }));
    const max = answerMax(big);
    expect(answerSize(big)).toBe('m');
    for (const q of big) expect(normalizeAnswer([...q.expected].reduce((t, k) => appendAnswer(t, k, max), ''))).toBe(q.expected);
    /* 기본 규정 8×8 은 16자리라 지금 크기 */
    const eight = Array.from({ length: 50 }, () => CALC_MAKERS.multiplication.make(r, { digitsA: 8, digitsB: 8 }));
    expect(answerSize(eight)).toBe('l');
    expect(answerMax(eight)).toBe(18);
  });

  it('덧셈 15자리 × 30개도 칠 수 있다', () => {
    const r = seeded('add-max');
    const qs = Array.from({ length: 50 }, () => CALC_MAKERS.addition.make(r, { digits: 15, terms: 30 }));
    const max = answerMax(qs);
    for (const q of qs) expect(normalizeAnswer([...q.expected].reduce((t, k) => appendAnswer(t, k, max), ''))).toBe(q.expected);
  });
});

describe('덧셈·곱셈 문항 만들기(CALC_MAKERS)', () => {
  const addRules = { items: 10, timeLimitSec: 0, penaltyPerWrong: 0, digits: 10, terms: 10 };
  const mulRules = { items: 10, timeLimitSec: 0, penaltyPerWrong: 0, digitsA: 8, digitsB: 8 };
  const add = calcLevels('addition');
  const mul = calcLevels('multiplication');

  it('연습 칸은 칸 설정, 모의 대회 칸은 규정 그대로', () => {
    expect(CALC_MAKERS.addition.params(addRules, add[0])).toEqual({ digits: 2, terms: 5 });
    expect(CALC_MAKERS.addition.params({ ...addRules, digits: 12, terms: 20 }, add.at(-1)!)).toEqual({ digits: 12, terms: 20 });
    expect(CALC_MAKERS.multiplication.params(mulRules, mul[2])).toEqual({ digitsA: 4, digitsB: 4 });
    expect(CALC_MAKERS.multiplication.params({ ...mulRules, digitsA: 12, digitsB: 3 }, mul.at(-1)!)).toEqual({ digitsA: 12, digitsB: 3 });
  });

  it('답 조건 한 줄', () => {
    expect(CALC_MAKERS.addition.ask({ digits: 2, terms: 5 })).toBe('5개의 합');
    expect(CALC_MAKERS.multiplication.ask({ digitsA: 8, digitsB: 8 })).toBe('곱');
  });

  it('칸 설정대로 만든다 — 정답은 자판으로 칠 수 있는 글자', () => {
    const r = seeded('mk');
    for (const l of add) {
      const q = CALC_MAKERS.addition.make(r, CALC_MAKERS.addition.params(addRules, l));
      const p = CALC_MAKERS.addition.params(addRules, l);
      expect(q.lines, l.id).toHaveLength(Number(p.terms));
      expect(q.lines!.every((s) => s.length === Number(p.digits)), l.id).toBe(true);
      expect(normalizeAnswer(typeAll([...q.expected]))).toBe(q.expected);
    }
    for (const l of mul) {
      const p = CALC_MAKERS.multiplication.params(mulRules, l);
      const q = CALC_MAKERS.multiplication.make(r, p);
      expect(q.lines![0].length, l.id).toBe(Number(p.digitsA));
      expect(q.lines![1], l.id).toMatch(new RegExp(`^× [1-9]\\d{${Number(p.digitsB) - 1}}$`));
    }
  });

  it('문제 글자 크기 — 2×2 는 l, 8×8(× 붙은 줄 10자)과 10자리 덧셈은 m', () => {
    const r = seeded('psize');
    const mk = (id: 'addition' | 'multiplication', p: Record<string, number>) => Array.from({ length: 10 }, () => CALC_MAKERS[id].make(r, p));
    expect(promptSize(mk('multiplication', { digitsA: 2, digitsB: 2 }))).toBe('l');
    expect(promptSize(mk('multiplication', { digitsA: 8, digitsB: 8 }))).toBe('m');
    expect(promptSize(mk('addition', { digits: 6, terms: 10 }))).toBe('l');
    expect(promptSize(mk('addition', { digits: 10, terms: 10 }))).toBe('m');
  });
});

describe('세로셈 배치(stackLayout · flashFontPx) — 한 판 단위', () => {
  const r = seeded('stack');
  const add = (digits: number, terms: number) => Array.from({ length: 10 }, () => CALC_MAKERS.addition.make(r, { digits, terms }));
  const mul = (a: number, b: number) => Array.from({ length: 10 }, () => CALC_MAKERS.multiplication.make(r, { digitsA: a, digitsB: b }));
  /** 줄 수 × 줄 높이 + 둘레 — 측정 화면 전체 높이 */
  const height = (qs: { lines?: string[] }[], l: { px: number; compact: boolean }) =>
    Math.max(...qs.map((q) => q.lines!.length)) * l.px * STACK_LH + STACK_CHROME[l.compact ? 'compact' : 'normal'];
  /** 가장 긴 줄의 폭(px) — 카드 안쪽 323px 에 들어야 한다 */
  const width = (qs: { lines?: string[] }[], px: number) => Math.max(...qs.flatMap((q) => q.lines!.map((s) => s.length))) * px * 0.62;

  it('10자리 × 10개는 보이는 높이 667px 에 카드·답 칸·자판과 함께 든다(촘촘한 배치, 18px)', () => {
    const qs = add(10, 10);
    const l = stackLayout(qs, 667);
    expect(l).toEqual({ px: 18, compact: true });
    expect(height(qs, l)).toBeLessThanOrEqual(667);
  });

  it('덧셈 사다리 칸마다 667px 안에 든다', () => {
    for (const [d, t] of [[2, 5], [3, 5], [4, 10], [6, 10], [10, 10]]) {
      const qs = add(d, t);
      const l = stackLayout(qs, 667);
      expect(height(qs, l), `${d}×${t}`).toBeLessThanOrEqual(667);
      expect(width(qs, l.px), `${d}×${t}`).toBeLessThanOrEqual(323);
      expect(l.px, `${d}×${t}`).toBeGreaterThanOrEqual(18);
    }
    /* 5개짜리는 글자가 훨씬 크다 */
    expect(stackLayout(add(2, 5), 667).px).toBeGreaterThanOrEqual(36);
  });

  it('곱셈은 보통 배치 — 8×8 은 promptSize(m) 그대로 40px, 12×12 는 카드 폭에 맞춰 줄인다', () => {
    expect(stackLayout(mul(8, 8), 667)).toEqual({ px: 40, compact: false });
    const big = mul(12, 12);
    const l = stackLayout(big, 667);
    expect(l.compact).toBe(false);
    expect(width(big, l.px)).toBeLessThanOrEqual(323);
    for (const [a, b] of [[2, 2], [3, 3], [5, 5], [7, 7], [8, 8], [12, 12], [1, 1]]) {
      const qs = mul(a, b);
      expect(height(qs, stackLayout(qs, 667)), `${a}×${b}`).toBeLessThanOrEqual(667);
    }
  });

  it('보이는 높이가 넉넉하면 보통 배치에 더 큰 글자', () => {
    const qs = add(10, 10);
    const tall = stackLayout(qs, 900);
    expect(tall.compact).toBe(false);
    expect(tall.px).toBeGreaterThan(stackLayout(qs, 667).px);
    expect(height(qs, tall)).toBeLessThanOrEqual(900);
    /* promptSize 크기(10자리 = m 40px)를 넘지는 않는다 */
    expect(stackLayout(qs, 2000).px).toBe(40);
  });

  it('규정 끝값(15자리 × 30개)은 16px 밑으로 줄이지 않는다', () => {
    expect(stackLayout(add(15, 30), 667)).toEqual({ px: 16, compact: true });
  });

  it('플래시 칸 글자 — 가장 긴 수가 카드 폭에 드는 크기, 60px 까지', () => {
    expect(flashFontPx(add(2, 5))).toBe(60);
    expect(flashFontPx(add(10, 10))).toBe(52);
    const fifteen = add(15, 10);
    expect(width(fifteen, flashFontPx(fifteen))).toBeLessThanOrEqual(323);
  });

  it('기둥이 좁은 휴대폰(360px, 카드 안쪽 308px)에서는 그 폭에 맞춘다', () => {
    const ten = add(10, 10);
    expect(width(ten, flashFontPx(ten, 360))).toBeLessThanOrEqual(308);
    expect(flashFontPx(ten, 360)).toBeLessThan(flashFontPx(ten));
    const big = mul(12, 12);
    expect(width(big, stackLayout(big, 667, 360).px)).toBeLessThanOrEqual(308);
    /* 넓은 화면(기둥 480px)은 더 크게, 60px 까지 */
    expect(flashFontPx(ten, 480)).toBe(60);
  });
});
