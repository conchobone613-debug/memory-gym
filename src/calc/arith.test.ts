import { describe, expect, it } from 'vitest';
import { addColumns, addExplain, joinColumns, makeAddition, makeMultiply, mulColumns, mulExplain, placeName } from './arith';
import { normalizeAnswer } from './problem';
import { randInt, seeded, type Rng } from './rng';

/** digits 자리 수 글자(첫 자리 0 아님) — 시험용 */
function num(r: Rng, digits: number): string {
  let s = String(1 + randInt(r, 9));
  for (let i = 1; i < digits; i++) s += String(randInt(r, 10));
  return s;
}

describe('곱셈 — 큰 정수 정답', () => {
  it('8×8 무작위 2000개 — 정답은 BigInt 곱, 교차곱셈 자리를 이어 붙여도 같다', () => {
    const r = seeded('mul-8x8');
    for (let k = 0; k < 2000; k++) {
      const q = makeMultiply(r, { a: 8, b: 8 });
      const [A, B] = q.prompt.split(' × ');
      expect(A, q.prompt).toMatch(/^[1-9]\d{7}$/);
      expect(B, q.prompt).toMatch(/^[1-9]\d{7}$/);
      const product = (BigInt(A) * BigInt(B)).toString();
      expect(q.expected, q.prompt).toBe(product);
      expect(joinColumns(mulColumns(A, B)), q.prompt).toBe(product);
      expect(q.explain.at(-1), q.prompt).toBe(`곱 = ${product}`);
    }
  });

  it('1×1 부터 12×12 까지 자릿수를 섞어도 교차곱셈 = BigInt 곱', () => {
    const r = seeded('mul-mix');
    for (let a = 1; a <= 12; a++) {
      for (let b = 1; b <= 12; b++) {
        for (let k = 0; k < 20; k++) {
          const A = num(r, a);
          const B = num(r, b);
          const cols = mulColumns(A, B);
          expect(cols.map((c) => c.col), `${A}×${B}`).toEqual(Array.from({ length: a + b - 1 }, (_, i) => i));
          expect(joinColumns(cols), `${A}×${B}`).toBe((BigInt(A) * BigInt(B)).toString());
        }
      }
    }
  });

  it('12×12 는 24자리 가까이 — 정답 글자가 곧 정규형이다', () => {
    const r = seeded('mul-12');
    for (let k = 0; k < 300; k++) {
      const q = makeMultiply(r, { a: 12, b: 12 });
      const [A, B] = q.prompt.split(' × ');
      expect(q.expected).toBe((BigInt(A) * BigInt(B)).toString());
      expect(q.expected.length).toBeGreaterThanOrEqual(23);
      expect(q.expected.length).toBeLessThanOrEqual(24);
      expect(normalizeAnswer(q.expected)).toBe(q.expected);
    }
  });

  it('0 이 섞인 수와 1×1', () => {
    for (const [A, B] of [['10000001', '10000001'], ['10000000', '90000009'], ['99999999', '99999999'], ['7', '8'], ['1', '1'], ['9', '9'], ['105', '1']]) {
      expect(joinColumns(mulColumns(A, B)), `${A}×${B}`).toBe((BigInt(A) * BigInt(B)).toString());
      expect(mulExplain(A, B).at(-1)).toBe(`곱 = ${BigInt(A) * BigInt(B)}`);
    }
  });

  it('자리 셈: 결과 k 자리 = Σ a_i·b_j (i+j=k) + 올림', () => {
    const cols = mulColumns('35', '24');
    /* 일의 자리 5×4 = 20 → 0 올림 2 · 십의 자리 3×4 + 5×2 = 22, 올림 2 더해 24 → 4 올림 2 · 백의 자리 3×2 = 6, 올림 2 더해 8 */
    expect(cols).toEqual([
      { col: 0, pairs: [[5, 4]], sum: 20, carryIn: 0, total: 20, digit: 0, carryOut: 2 },
      { col: 1, pairs: [[3, 4], [5, 2]], sum: 22, carryIn: 2, total: 24, digit: 4, carryOut: 2 },
      { col: 2, pairs: [[3, 2]], sum: 6, carryIn: 2, total: 8, digit: 8, carryOut: 0 },
    ]);
    expect(joinColumns(cols)).toBe('840');
  });

  it('풀이 줄 — 교차곱셈, 자리마다 한 줄, 마지막 올림, 곱', () => {
    expect(mulExplain('35', '24')).toEqual([
      '교차곱셈 — 일의 자리부터',
      '일의 자리: 5×4 = 20 → 0, 올림 2',
      '십의 자리: 3×4 + 5×2 = 22, 올림 2 더해 24 → 4, 올림 2',
      '백의 자리: 3×2 = 6, 올림 2 더해 8 → 8',
      '곱 = 840',
    ]);
    expect(mulExplain('99', '99')).toEqual([
      '교차곱셈 — 일의 자리부터',
      '일의 자리: 9×9 = 81 → 1, 올림 8',
      '십의 자리: 9×9 + 9×9 = 162, 올림 8 더해 170 → 0, 올림 17',
      '백의 자리: 9×9 = 81, 올림 17 더해 98 → 8, 올림 9',
      '마지막 올림 9를 앞에 붙입니다',
      '곱 = 9801',
    ]);
    expect(mulExplain('7', '8').slice(-2)).toEqual(['마지막 올림 5를 앞에 붙입니다', '곱 = 56']);
    expect(mulExplain('4', '8').slice(-2)).toEqual(['마지막 올림 3을 앞에 붙입니다', '곱 = 32']);
  });

  it('8×8 가운데 자리는 곱 8개를 한 줄에 적는다', () => {
    const lines = mulExplain('12345678', '87654321');
    expect(lines).toHaveLength(1 + 15 + 1 + 1);
    expect(lines[8].startsWith('천만의 자리: 1×1 + 2×2 + 3×3 + 4×4 + 5×5 + 6×6 + 7×7 + 8×8 = 204')).toBe(true);
  });

  it('문항 모양 — 세로셈 두 줄, 기록용 한 줄', () => {
    const q = makeMultiply(seeded('shape'), { a: 3, b: 2 });
    const [A, B] = q.prompt.split(' × ');
    expect(q.kind).toBe('mul');
    expect(q.lines).toEqual([A, `× ${B}`]);
    expect(A).toMatch(/^[1-9]\d{2}$/);
    expect(B).toMatch(/^[1-9]\d$/);
  });
});

describe('덧셈', () => {
  it('자리 셈으로 합을 다시 만든다 — 10자리 × 10개, 15자리 × 30개', () => {
    const r = seeded('add-cols');
    for (const [digits, terms] of [[10, 10], [15, 30], [1, 2], [2, 5]]) {
      for (let k = 0; k < 300; k++) {
        const q = makeAddition(r, { digits, terms });
        const sum = q.lines!.reduce((a, s) => a + BigInt(s), 0n).toString();
        expect(q.expected).toBe(sum);
        expect(joinColumns(addColumns(q.lines!))).toBe(sum);
        expect(q.explain.at(-1)).toBe(`합 = ${sum}`);
      }
    }
  });

  it('수는 정확히 digits 자리(첫 자리 0 아님, 1자리면 1–9) · 이웃한 두 수는 같지 않다', () => {
    const r = seeded('add-shape');
    for (const [digits, terms] of [[1, 30], [2, 5], [10, 10], [15, 30]]) {
      for (let k = 0; k < 200; k++) {
        const q = makeAddition(r, { digits, terms });
        expect(q.kind).toBe('add');
        expect(q.lines).toHaveLength(terms);
        expect(q.prompt).toBe(q.lines!.join(' + '));
        for (const s of q.lines!) expect(s).toMatch(new RegExp(`^[1-9]\\d{${digits - 1}}$`));
        for (let i = 1; i < terms; i++) expect(q.lines![i], q.prompt).not.toBe(q.lines![i - 1]);
      }
    }
  });

  it('자리 셈과 풀이 줄 — 올림 더해, 마지막 올림, 합', () => {
    const terms = ['47', '85', '69'];
    expect(addColumns(terms)).toEqual([
      { col: 0, digits: [7, 5, 9], sum: 21, carryIn: 0, total: 21, digit: 1, carryOut: 2 },
      { col: 1, digits: [4, 8, 6], sum: 18, carryIn: 2, total: 20, digit: 0, carryOut: 2 },
    ]);
    expect(addExplain(terms)).toEqual([
      '일의 자리: 7+5+9 = 21 → 1, 올림 2',
      '십의 자리: 4+8+6 = 18, 올림 2 더해 20 → 0, 올림 2',
      '마지막 올림 2를 앞에 붙입니다',
      '합 = 201',
    ]);
    expect(addExplain(['12', '34'])).toEqual(['일의 자리: 2+4 = 6 → 6', '십의 자리: 1+3 = 4 → 4', '합 = 46']);
  });

  it('길이가 다른 수는 그 자리까지 닿는 수만 더한다', () => {
    const cols = addColumns(['999', '1']);
    expect(cols.map((c) => c.digits)).toEqual([[9, 1], [9], [9]]);
    expect(joinColumns(cols)).toBe('1000');
  });
});

describe('자리 이름', () => {
  it('일·십·백·천·만 … 천조, 넘으면 k째 자리', () => {
    expect([0, 1, 2, 3, 4, 5, 8, 12, 15].map(placeName)).toEqual([
      '일의 자리', '십의 자리', '백의 자리', '천의 자리', '만의 자리', '십만의 자리', '억의 자리', '조의 자리', '천조의 자리',
    ]);
    expect(placeName(16)).toBe('17째 자리');
    expect(placeName(22)).toBe('23째 자리');
  });
});

describe('같은 시드면 같은 문제', () => {
  it('덧셈·곱셈 모두', () => {
    const run = (seed: string) => {
      const r = seeded(seed);
      return Array.from({ length: 30 }, (_, i) => (i % 2 ? makeAddition(r, { digits: 6, terms: 10 }) : makeMultiply(r, { a: 8, b: 8 })));
    };
    expect(run('same')).toEqual(run('same'));
    expect(run('same')).not.toEqual(run('other'));
  });
});
