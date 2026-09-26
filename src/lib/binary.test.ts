import { describe, expect, it } from 'vitest';
import {
  BINARY_CELL, BINARY_ROW, binaryRowScore, bitsToKey, cellRows, joinCells, randomBits, splitBits, toBinaryCode,
} from './binary';

const bits6 = (n: number) => n.toString(2).padStart(6, '0');
/** i 번째 자리를 뒤집는다 */
const flip = (s: string, ...at: number[]) => [...s].map((c, i) => (at.includes(i) ? (c === '0' ? '1' : '0') : c)).join('');
/** 0/1 이 섞인 n 자리(규칙적이라 시험이 재현된다) */
const seq = (n: number) => Array.from({ length: n }, (_, i) => String((i * 7 + (i >> 2)) % 2)).join('');
const blanks = (n: number) => ' '.repeat(n);

describe('bitsToKey — 6자리를 두 자리 숫자 이미지 키로', () => {
  it('예시 값', () => {
    expect(bitsToKey('101011', 'b3')).toBe('53');
    expect(bitsToKey('101011', 'b6')).toBe('43');
    expect(bitsToKey('000101', 'b6')).toBe('05');
    expect(bitsToKey('000101', 'b3')).toBe('05');
    expect(bitsToKey('111111', 'b3')).toBe('77');
    expect(bitsToKey('111111', 'b6')).toBe('63');
  });

  it('64가지 전부 — 두 방식 모두 겹치지 않고 두 자리 숫자 키가 된다', () => {
    for (const code of ['b3', 'b6'] as const) {
      const keys = Array.from({ length: 64 }, (_, n) => bitsToKey(bits6(n), code));
      keys.forEach((k, n) => {
        expect(k, `${code} ${bits6(n)}`).toBe(code === 'b3' ? `${n >> 3}${n & 7}` : String(n).padStart(2, '0'));
        expect(k).toMatch(/^\d\d$/);
      });
      expect(new Set(keys).size).toBe(64);
    }
  });

  it('6자리 0/1 이 아니면 null', () => {
    for (const bad of ['', '10101', '1010111', '10a011', '10 011', '222222']) {
      expect(bitsToKey(bad, 'b3'), bad).toBeNull();
      expect(bitsToKey(bad, 'b6'), bad).toBeNull();
    }
  });
});

describe('이진수 도우미', () => {
  it('세 자리씩 나눠 보여 준다', () => {
    expect(splitBits('101011')).toEqual(['101', '011']);
    expect(splitBits('1010110', 3)).toEqual(['101', '011', '0']);
  });

  it('칸을 다섯 개씩 줄로 묶는다', () => {
    expect(BINARY_ROW / BINARY_CELL).toBe(5);
    const rows = cellRows(Array.from({ length: 12 }, (_, i) => i));
    expect(rows.map((r) => r.length)).toEqual([5, 5, 2]);
  });

  it('칸 답을 칸 길이로 맞춰 이어 붙인다(빈 자리는 공백)', () => {
    expect(joinCells(['101011', '10', ''], 6)).toBe(`101011${'10    '}${blanks(6)}`);
    expect(joinCells(['1234567'], 6)).toBe('123456');
  });

  it('저장된 방식 값을 읽는다 — 모르는 값은 기본', () => {
    expect(toBinaryCode('b6')).toBe('b6');
    expect(toBinaryCode('zz')).toBe('b3');
    expect(toBinaryCode(undefined, 'b6')).toBe('b6');
  });

  it('무작위 비트는 0 과 1 만, 개수대로', () => {
    const b = randomBits(300);
    expect(b).toHaveLength(300);
    expect(b.every((x) => x === '0' || x === '1')).toBe(true);
    expect(new Set(b).size).toBe(2);
  });
});

describe('binaryRowScore — 세계기억력대회 줄 점수', () => {
  const exp = seq(90); // 3줄

  it('전부 맞으면 줄마다 30점', () => {
    const r = binaryRowScore(exp, exp);
    expect(r).toMatchObject({ score: 90, max: 90 });
    expect(r.rows).toEqual([
      { score: 30, max: 30, errors: 0, attempted: true },
      { score: 30, max: 30, errors: 0, attempted: true },
      { score: 30, max: 30, errors: 0, attempted: true },
    ]);
  });

  it('한 줄에 하나 틀리면 15점, 둘 이상이면 0점', () => {
    expect(binaryRowScore(exp, flip(exp, 3)).rows.map((x) => x.score)).toEqual([15, 30, 30]);
    expect(binaryRowScore(exp, flip(exp, 3, 29)).rows.map((x) => x.score)).toEqual([0, 30, 30]);
    expect(binaryRowScore(exp, flip(exp, 3, 40)).score).toBe(15 + 15 + 30);
  });

  it('빈칸도 틀림으로 센다', () => {
    const ans = `${exp.slice(0, 10)} ${exp.slice(11)}`;
    expect(binaryRowScore(exp, ans).rows[0]).toEqual({ score: 15, max: 30, errors: 1, attempted: true });
  });

  it('가운데 빈 줄은 0점(뒤에 적은 줄이 있으니 시도한 줄)', () => {
    const ans = exp.slice(0, 30) + blanks(30) + exp.slice(60);
    const r = binaryRowScore(exp, ans);
    expect(r.score).toBe(60);
    expect(r.rows[1]).toEqual({ score: 0, max: 30, errors: 30, attempted: true });
  });

  it('마지막으로 적은 줄은 적은 데까지(p자리)만 — 틀림 0 → p, 1 → ceil(p/2), 2 이상 → 0', () => {
    const upTo = (p: number, row2 = exp.slice(30, 30 + p)) => exp.slice(0, 30) + row2 + blanks(60 - p);
    expect(binaryRowScore(exp, upTo(10)).rows[1]).toEqual({ score: 10, max: 30, errors: 0, attempted: true });
    expect(binaryRowScore(exp, upTo(10, flip(exp.slice(30, 40), 4))).rows[1].score).toBe(5);
    expect(binaryRowScore(exp, upTo(9, flip(exp.slice(30, 39), 4))).rows[1].score).toBe(5); // ceil(9/2)
    expect(binaryRowScore(exp, upTo(10, flip(exp.slice(30, 40), 1, 4))).rows[1].score).toBe(0);
    /* 적은 자리 사이의 빈칸은 틀림이다 — 마지막 적은 자리가 p 를 정한다 */
    const gap = `${exp.slice(30, 33)} ${exp.slice(34, 36)}`;
    expect(binaryRowScore(exp, upTo(6, gap)).rows[1]).toEqual({ score: 3, max: 30, errors: 1, attempted: true });
    expect(binaryRowScore(exp, upTo(10)).score).toBe(40);
  });

  it('마지막으로 적은 줄 뒤의 줄은 시도 안 함 = 0', () => {
    const r = binaryRowScore(exp, exp.slice(0, 30));
    expect(r.score).toBe(30);
    expect(r.rows.slice(1)).toEqual([
      { score: 0, max: 30, errors: 0, attempted: false },
      { score: 0, max: 30, errors: 0, attempted: false },
    ]);
  });

  it('아무것도 안 적었으면 0 — 모든 줄이 시도 안 함', () => {
    const r = binaryRowScore(exp, blanks(90));
    expect(r.score).toBe(0);
    expect(r.rows.every((x) => !x.attempted && x.score === 0)).toBe(true);
    expect(binaryRowScore(exp, '').score).toBe(0);
  });

  it('출제 길이가 30 배수가 아니면 마지막 줄 만점은 그 줄 길이', () => {
    const e45 = seq(45);
    const r = binaryRowScore(e45, e45);
    expect(r).toMatchObject({ score: 45, max: 45 });
    expect(r.rows.map((x) => x.max)).toEqual([30, 15]);
    expect(binaryRowScore(e45, flip(e45, 40)).score).toBe(30 + 8); // ceil(15/2)
    /* 출제보다 긴 답은 보지 않는다 */
    expect(binaryRowScore(e45, `${e45}1111`).score).toBe(45);
  });
});
