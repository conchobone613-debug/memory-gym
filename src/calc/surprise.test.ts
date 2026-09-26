import { afterEach, describe, expect, it } from 'vitest';
import { CALC_EVENTS } from '../data/events';
import { defaultRules } from '../lib/rules';
import { calcTypeLabel, CALC_MAKERS } from './makers';
import { calcLevels } from './ladders';
import { appendAnswer, normalizeAnswer, type Problem } from './problem';
import { randInt, seeded, type Rng } from './rng';
import {
  contestTypes, divAnswer, divExplain, makeSurprise, makeSurpriseRun, MIX, surpriseAsk, SURPRISE_TYPES, surpriseTypeOptions,
  type SurpriseCtx, type SurpriseType,
} from './surprise';

const TRUNC: SurpriseCtx = { rounding: 'trunc' };
const ROUND: SurpriseCtx = { rounding: 'round' };
const N = 3000;

/** 한 유형 n 문항 */
const many = (type: string, n = N, ctx = TRUNC, seed = type) => {
  const r = seeded(seed);
  return Array.from({ length: n }, () => makeSurprise(r, ctx, { type }));
};

/** 시험용 작은 식 계산기 — 괄호·+ − × ÷(나머지 없이), 정수. 문제 글자를 그대로 다시 계산한다 */
function evaluate(src: string): bigint {
  const toks = src.match(/\d+|[()+×÷−]/g) ?? [];
  expect(toks.join(''), src).toBe(src.replace(/ /g, '')); // 모르는 글자가 없다
  let i = 0;
  const atom = (): bigint => {
    const t = toks[i++];
    if (t === '(') {
      const v = sum();
      expect(toks[i++], src).toBe(')');
      return v;
    }
    expect(t, src).toMatch(/^\d+$/);
    return BigInt(t);
  };
  const prod = (): bigint => {
    let v = atom();
    while (toks[i] === '×' || toks[i] === '÷') {
      const op = toks[i++];
      const r = atom();
      if (op === '×') v *= r;
      else {
        expect(v % r, src).toBe(0n);
        v /= r;
      }
    }
    return v;
  };
  const sum = (): bigint => {
    let v = prod();
    while (toks[i] === '+' || toks[i] === '−') {
      const op = toks[i++];
      const r = prod();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  expect(i, src).toBe(toks.length);
  return v;
}

/** 소수 둘째 자리 글자(정수 v = 값 × 100) */
const two = (v: bigint) => `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;

/** 자판으로 친 글자 */
const typed = (s: string) => normalizeAnswer([...s].reduce((t, k) => appendAnswer(t, k, 30), ''));

describe('서프라이즈 등록부', () => {
  it('첫 다섯 유형 — id 는 겹치지 않고, 유형 고르기는 섞기가 먼저', () => {
    const ids = SURPRISE_TYPES.map((t) => t.id);
    expect(ids).toEqual(['sq', 'mul3', 'expr', 'div', 'add10']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(MIX);
    expect(surpriseTypeOptions()).toEqual([
      { value: 'mix', label: '섞기' }, { value: 'sq', label: '제곱' }, { value: 'mul3', label: '3×3 곱셈' },
      { value: 'expr', label: '괄호 계산' }, { value: 'div', label: '나눗셈' }, { value: 'add10', label: '2자리 10개 덧셈' },
    ]);
  });

  describe('새 유형 한 줄 추가', () => {
    const cube: SurpriseType = {
      id: 'cube', name: '세제곱',
      make: (rng: Rng): Problem => {
        const n = BigInt(10 + randInt(rng, 90));
        return { kind: '', prompt: `${n}³`, expected: String(n ** 3n), explain: [`${n}³ = ${n ** 3n}`] };
      },
    };
    const len = SURPRISE_TYPES.length;
    afterEach(() => { SURPRISE_TYPES.splice(len); });

    it('한 항목을 더한 배열로 고르기·만들기·섞기·모의 대회 순서가 그 유형을 낸다', () => {
      const types = [...SURPRISE_TYPES, cube];
      const r = seeded('cube');
      const q = makeSurprise(r, TRUNC, { type: 'cube', types });
      expect(q.kind).toBe('cube');
      expect(q.prompt).toMatch(/^\d{2}³$/);
      const mixed = new Set(Array.from({ length: 300 }, () => makeSurprise(r, TRUNC, { types }).kind));
      expect(mixed).toEqual(new Set(types.map((t) => t.id)));
      const order = contestTypes(r, 12, types);
      expect(order).toHaveLength(12);
      expect(new Set(order)).toEqual(new Set(types.map((t) => t.id)));
      expect(new Set(makeSurpriseRun(r, TRUNC, 6, { types }).map((p) => p.kind))).toEqual(new Set(types.map((t) => t.id)));
      expect(surpriseTypeOptions(types).at(-1)).toEqual({ value: 'cube', label: '세제곱' });
      expect(surpriseAsk(TRUNC, 'cube', types)).toBe('세제곱');
      expect(new Set(types.map((t) => t.id)).size).toBe(types.length);
    });

    it('등록부에 한 줄을 더하면 다른 파일을 고치지 않아도 실행기(CALC_MAKERS)와 기록 이름이 받는다', () => {
      SURPRISE_TYPES.push(cube);
      const m = CALC_MAKERS.surprise;
      expect(m.typeOptions!().map((o) => o.value)).toContain('cube');
      const r = seeded('push');
      expect(m.make(r, { type: 'cube', rounding: 'trunc' }).kind).toBe('cube');
      expect(m.makeAll!(r, { type: 'cube', rounding: 'trunc' }, 5).every((q) => q.kind === 'cube')).toBe(true);
      const contest = m.makeAll!(r, m.params(defaultRules(CALC_EVENTS.find((e) => e.id === 'surprise')!.rules), calcLevels('surprise')[1]), 12);
      expect(new Set(contest.map((q) => q.kind))).toEqual(new Set(['sq', 'mul3', 'expr', 'div', 'add10', 'cube']));
      expect(m.ask({ type: 'cube', rounding: 'trunc' })).toBe('세제곱');
      expect(calcTypeLabel('surprise', { level: 1, type: 'cube' })).toBe('세제곱');
    });
  });
});

describe('유형마다 정답을 따로 계산해 대조', () => {
  it('제곱 — n 2~4자리, n² 은 BigInt, 풀이는 h²×100 + 2hu×10 + u²', () => {
    const lens = new Set<number>();
    for (const q of many('sq')) {
      const [, s] = q.prompt.match(/^(\d{2,4})²$/)!;
      lens.add(s.length);
      const n = BigInt(s);
      expect(q.expected).toBe(String(n * n));
      expect(q.explain[0]).toBe(`${n} = ${n / 10n}×10 + ${n % 10n}`);
      const parts = q.explain[2].match(/^= (\d+) \+ (\d+) \+ (\d+)$/)!.slice(1).map(BigInt);
      expect(parts[0] + parts[1] + parts[2], q.prompt).toBe(n * n);
    }
    expect(lens).toEqual(new Set([2, 3, 4]));
  });

  it('3×3 곱셈 — 세로셈 두 줄, 곱은 BigInt', () => {
    for (const q of many('mul3')) {
      const [A, B] = q.prompt.split(' × ');
      expect(A).toMatch(/^[1-9]\d{2}$/);
      expect(B).toMatch(/^[1-9]\d{2}$/);
      expect(q.lines).toEqual([A, `× ${B}`]);
      expect(q.expected).toBe(String(BigInt(A) * BigInt(B)));
      expect(q.explain[0]).toBe('교차곱셈 — 일의 자리부터');
    }
  });

  it('2자리 10개 덧셈 — 세로셈 열 줄, 합은 BigInt', () => {
    for (const q of many('add10')) {
      expect(q.lines).toHaveLength(10);
      expect(q.lines!.every((s) => /^[1-9]\d$/.test(s))).toBe(true);
      expect(q.expected).toBe(String(q.lines!.reduce((a, s) => a + BigInt(s), 0n)));
    }
  });

  it('괄호 계산 — 문제 글자를 식 계산기로 다시 계산, 세 꼴이 모두 나오고 단계 풀이도 맞다', () => {
    const forms = [
      /^\((\d{2}) \+ (\d{2})\) × ([3-9]) − (\d{2})$/,
      /^\((\d{2,3}) − (\d{2,3})\) × \((\d{2}) \+ (\d{2})\)$/,
      /^\((\d{2}) × ([1-9]) \+ (\d+)\) ÷ ([3-9])$/,
    ];
    const seen = new Set<number>();
    for (const q of many('expr')) {
      const k = forms.findIndex((f) => f.test(q.prompt));
      expect(k, q.prompt).toBeGreaterThanOrEqual(0);
      seen.add(k);
      const nums = q.prompt.match(forms[k])!.slice(1).map(Number);
      if (k === 1) expect(nums[0], q.prompt).toBeGreaterThan(nums[1]);
      if (k === 2) expect(Number(q.expected), q.prompt).toBeGreaterThanOrEqual(12);
      if (k === 2) expect(Number(q.expected), q.prompt).toBeLessThanOrEqual(99);
      expect(String(evaluate(q.prompt)), q.prompt).toBe(q.expected);
      expect(q.explain).toHaveLength(3);
      q.explain.forEach((line, i) => {
        const [, left, right] = line.match(/^[①②③] (.+) = (\d+)$/)!;
        expect(line.startsWith('①②③'[i])).toBe(true);
        expect(evaluate(left), line).toBe(BigInt(right));
      });
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it('나눗셈 — 소수 둘째 자리, 버림·반올림을 BigInt 로 따로 계산', () => {
    const t = many('div', N, TRUNC, 'div');
    const r = many('div', N, ROUND, 'div');
    for (let i = 0; i < N; i++) {
      expect(r[i].prompt).toBe(t[i].prompt); // 끝자리는 문제를 바꾸지 않는다
      const [, as, bs] = t[i].prompt.match(/^(\d{4,6}) ÷ (\d{2,3})$/)!;
      const a = BigInt(as);
      const b = BigInt(bs);
      expect(b % 10n).not.toBe(0n);
      const q = (a * 100n) / b;
      const rem = (a * 100n) % b;
      expect(t[i].expected).toBe(two(q));
      expect(r[i].expected).toBe(two(2n * rem >= b ? q + 1n : q));
      expect(t[i].expected).toMatch(/^\d+\.\d{2}$/);
      expect(r[i].expected).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('나눗셈 경계 — 셋째 자리가 정확히 5, 나머지 0 이면 .00, 반올림 올림이 정수로 넘어감', () => {
    expect(divAnswer(1002n, 16n, 'trunc')).toBe('62.62'); // 62.625
    expect(divAnswer(1002n, 16n, 'round')).toBe('62.63');
    expect(divAnswer(1025n, 64n, 'trunc')).toBe('16.01'); // 16.015625
    expect(divAnswer(1025n, 64n, 'round')).toBe('16.02');
    expect(divAnswer(1500n, 12n, 'trunc')).toBe('125.00');
    expect(divAnswer(123456n, 64n, 'round')).toBe('1929.00');
    expect(divAnswer(1000n, 16n, 'trunc')).toBe('62.50');
    expect(divAnswer(2210n, 201n, 'trunc')).toBe('10.99'); // 10.9950…
    expect(divAnswer(2210n, 201n, 'round')).toBe('11.00');
  });

  it('나눗셈 풀이 — 몫·나머지, 소수 자리마다 한 줄(반올림은 셋째까지), 끝에 끝자리 → 정답', () => {
    expect(divExplain(123456n, 78n, 'trunc')).toEqual([
      '123456 ÷ 78 = 1582 나머지 60',
      '600 ÷ 78 = 7 나머지 54 → 소수 첫째 7',
      '540 ÷ 78 = 6 나머지 72 → 소수 둘째 6',
      '버림 → 1582.76',
    ]);
    expect(divExplain(123456n, 78n, 'round')).toEqual([
      '123456 ÷ 78 = 1582 나머지 60',
      '600 ÷ 78 = 7 나머지 54 → 소수 첫째 7',
      '540 ÷ 78 = 6 나머지 72 → 소수 둘째 6',
      '720 ÷ 78 = 9 나머지 18 → 소수 셋째 9',
      '반올림 → 1582.77',
    ]);
    expect(divExplain(1500n, 12n, 'trunc').at(-1)).toBe('버림 → 125.00');
  });
});

describe('모든 유형 공통', () => {
  it('풀이 마지막 줄은 정답 · 결과는 양수 · 자판으로 칠 수 있다(나눗셈은 .00 까지)', () => {
    for (const ctx of [TRUNC, ROUND]) {
      for (const t of SURPRISE_TYPES) {
        for (const q of many(t.id, 500, ctx)) {
          expect(q.kind).toBe(t.id);
          expect(q.explain.at(-1)!.split(' ').at(-1), q.prompt).toBe(q.expected);
          expect(q.expected, q.prompt).toMatch(/^[1-9]\d*(\.\d{2})?$/);
          expect(typed(q.expected)).toBe(q.expected);
        }
      }
    }
    /* '.00' 을 빼고 치면 틀린다 — 끝 0 을 지우지 않는다 */
    expect(normalizeAnswer('125')).not.toBe(divAnswer(1500n, 12n, 'trunc'));
  });

  it('문제 글자는 × ÷ −(U+2212) 기호, 공백 하나씩', () => {
    for (const t of SURPRISE_TYPES) {
      for (const q of many(t.id, 300)) {
        expect(q.prompt, q.prompt).toMatch(/^[0-9()+×÷−² ]+$/);
        expect(q.prompt).not.toMatch(/ {2}|^ | $/);
        expect(q.prompt, '기호 양옆은 공백').not.toMatch(/\S[+×÷−]|[+×÷−]\S/);
        expect(q.prompt).not.toMatch(/[-*/]/);
      }
    }
  });

  it('같은 시드면 같은 문제 — 한 문항·한 판 모두', () => {
    const a = seeded('same');
    const b = seeded('same');
    for (let i = 0; i < 50; i++) expect(makeSurprise(a, ROUND)).toEqual(makeSurprise(b, ROUND));
    expect(makeSurpriseRun(seeded('run'), TRUNC, 20)).toEqual(makeSurpriseRun(seeded('run'), TRUNC, 20));
    expect(makeSurpriseRun(seeded('run'), TRUNC, 20)).not.toEqual(makeSurpriseRun(seeded('other'), TRUNC, 20));
  });

  it("섞기·모르는 유형은 등록부에서 무작위 — 'mix' 면 다섯 유형이 모두 나온다", () => {
    const r = seeded('mix');
    const kinds = new Set(Array.from({ length: 200 }, () => makeSurprise(r, TRUNC, { type: MIX }).kind));
    expect(kinds).toEqual(new Set(SURPRISE_TYPES.map((t) => t.id)));
    expect(SURPRISE_TYPES.map((t) => t.id)).toContain(makeSurprise(r, TRUNC, { type: 'no-such' }).kind);
    expect(SURPRISE_TYPES.map((t) => t.id)).toContain(makeSurprise(r, TRUNC).kind);
  });
});

describe('모의 대회 유형 순서(contestTypes) · 한 판 문항(makeSurpriseRun)', () => {
  it('문항 수만큼, 유형 수 이상이면 모든 유형이 한 번 이상 — 10문항 5유형은 두 번씩', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const o = contestTypes(seeded(seed), 10);
      expect(o).toHaveLength(10);
      for (const t of SURPRISE_TYPES) expect(o.filter((x) => x === t.id), seed).toHaveLength(2);
      const seven = contestTypes(seeded(seed), 7);
      expect(new Set(seven)).toEqual(new Set(SURPRISE_TYPES.map((t) => t.id)));
      const three = contestTypes(seeded(seed), 3);
      expect(new Set(three).size).toBe(3); // 유형보다 적으면 겹치지 않게 고른다
    }
    expect(contestTypes(seeded('x'), 0)).toEqual([]);
    expect(contestTypes(seeded('x'), 10, [])).toEqual([]);
    expect(contestTypes(seeded('s'), 10)).toEqual(contestTypes(seeded('s'), 10));
  });

  it('섞기 판은 그 순서대로, 유형 하나면 그 유형만', () => {
    const qs = makeSurpriseRun(seeded('r'), TRUNC, 10);
    for (const t of SURPRISE_TYPES) expect(qs.filter((q) => q.kind === t.id)).toHaveLength(2);
    expect(makeSurpriseRun(seeded('r'), ROUND, 8, { type: 'div' }).every((q) => q.kind === 'div')).toBe(true);
    expect(makeSurpriseRun(seeded('r'), TRUNC, 8, { type: MIX })).toHaveLength(8);
  });
});

describe('서프라이즈 문항 만들기(CALC_MAKERS.surprise)', () => {
  const ev = CALC_EVENTS.find((e) => e.id === 'surprise')!;
  const rules = defaultRules(ev.rules);
  const [l1, contest] = calcLevels('surprise');
  const m = CALC_MAKERS.surprise;

  it('연습 칸은 섞기, 모의 대회도 섞기 — 끝자리는 둘 다 규정', () => {
    expect(m.params(rules, l1)).toEqual({ type: 'mix', rounding: 'trunc' });
    expect(m.params({ ...rules, rounding: 'round' }, contest)).toEqual({ type: 'mix', rounding: 'round' });
  });

  it('안내 줄 — 섞기는 나눗셈 끝자리를, 유형 하나는 그 이름', () => {
    expect(m.ask({ type: 'mix', rounding: 'trunc' })).toBe('섞어서 · 나눗셈은 소수 둘째 자리 · 버림');
    expect(m.ask({ type: 'mix', rounding: 'round' })).toBe('섞어서 · 나눗셈은 소수 둘째 자리 · 반올림');
    expect(m.ask({ type: 'div', rounding: 'round' })).toBe('나눗셈 · 소수 둘째 자리 · 반올림');
    expect(m.ask({ type: 'sq', rounding: 'trunc' })).toBe('제곱');
    expect(m.ask({ type: 'expr', rounding: 'trunc' })).toBe('괄호 계산');
  });

  it('모의 대회 한 판(makeAll)은 규정 문항 수에 모든 유형이 고르게, 연습에서 유형을 고르면 그 유형만', () => {
    const qs = m.makeAll!(seeded('c'), m.params(rules, contest), Number(rules.items));
    expect(qs).toHaveLength(10);
    for (const t of SURPRISE_TYPES) expect(qs.filter((q) => q.kind === t.id)).toHaveLength(2);
    expect(m.makeAll!(seeded('c'), m.params(rules, contest), 10)).toEqual(qs);
    const sq = m.makeAll!(seeded('p'), { ...m.params(rules, l1), type: 'sq' }, 20);
    expect(sq.every((q) => q.kind === 'sq')).toBe(true);
    expect(m.make(seeded('p'), { ...m.params(rules, l1), type: 'div' }).kind).toBe('div');
  });

  it('유형 고르기 선택지와 기록 줄 이름 — 섞기 판·다른 종목은 이름 없음', () => {
    expect(m.typeOptions!()).toEqual(surpriseTypeOptions());
    expect(calcTypeLabel('surprise', { level: 1, type: 'sq' })).toBe('제곱');
    expect(calcTypeLabel('surprise', { level: 1, type: 'mix' })).toBeNull();
    expect(calcTypeLabel('surprise', { level: 2 })).toBeNull();
    expect(calcTypeLabel('addition', { level: 1, flash: 1, intervalMs: 800 })).toBeNull();
    expect(CALC_MAKERS.sqrt.typeOptions).toBeUndefined();
    expect(CALC_MAKERS.addition.makeAll).toBeUndefined();
  });
});
