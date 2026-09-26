import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, DEFAULT_SETTINGS, type RecallCell, type RecallSession } from './db';
import { confusionPairs } from './analytics';
import { rebuildImageStats } from './rebuild';
import { buildSessionReviewInput } from '../coach/review';

/* 듣기·이진수 판도 기존 기록 틀(recallSessions/recallCells)로 읽힌다 — 혼동 쌍 · 통계 다시 만들기 · 스승님 복기 입력 */

const T = Date.now();
let n = 0;
const session = (o: Partial<RecallSession>): RecallSession => ({
  id: `r${n++}`, mode: 'digits', presetName: 'p', stimulus: [], memorizeMs: 0, memorizeUsedMs: 1000, recallMs: 0,
  startedAt: T, correct: 0, wrong: 1, blank: 0, ...o,
});
const cell = (sessionId: string, expected: string, answered: string, index = 0): RecallCell => ({
  id: `c${n++}`, sessionId, index, expected, answered, isCorrect: expected === answered, errorTags: [],
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  /* 지금 설정은 6자리 방식 — 3자리 방식으로 한 옛 판이 그때 방식으로 읽히는지 본다 */
  await db.settings.put({ ...DEFAULT_SETTINGS, binaryCode: 'b6' });
  await db.imageSets.put({ id: 'n2', name: '숫자', domain: 'digit2', builtin: true, createdAt: 0, updatedAt: 0 });
  await db.images.bulkPut(['53', '52', '43', '42', '47'].map((key) => ({
    id: `i${key}`, setId: 'n2', key, name: `이미지${key}`, aliases: [], note: '', tags: [], updatedAt: 0,
  })));
});

describe('이진수 판의 칸은 그 판 방식으로 이미지 키가 된다', () => {
  async function seed() {
    const old = session({ mode: 'binary', eventId: 'binary', params: { code: 'b3', rowLen: 30 } });
    const cur = session({ mode: 'binary', eventId: 'binary' });
    const num = session({ eventId: 'speed-numbers' });
    await db.recallSessions.bulkAdd([old, cur, num]);
    await db.recallCells.bulkAdd([
      cell(old.id, '101011', '101010'),
      cell(old.id, '111111', '1111', 1), // 다 못 적은 칸 — 키를 못 만들어 뺀다
      cell(cur.id, '101011', '101010'),
      cell(num.id, '47', '42'),
    ]);
  }

  it('혼동 쌍 — 비트 문자열을 섞지 않는다', async () => {
    await seed();
    const pairs = await confusionPairs(20);
    expect(pairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ expected: '53', answered: '52', count: 1 }), // 옛 판: 3자리씩
      expect.objectContaining({ expected: '43', answered: '42', count: 1 }), // 방식 없는 판: 지금 설정(6자리)
      expect.objectContaining({ expected: '47', answered: '42', count: 1 }), // 숫자 판은 그대로
    ]));
    expect(pairs).toHaveLength(3);
    expect(pairs.some((p) => /^[01]{4,}$/.test(p.expected) || /^[01]{4,}$/.test(p.answered))).toBe(false);
  });

  it('통계를 다시 만들 때 틀린 칸을 그 판 방식의 이미지에 오답으로 센다', async () => {
    await seed();
    await rebuildImageStats();
    const stats = new Map((await db.imageStats.toArray()).map((s) => [s.imageId, s]));
    expect(stats.get('i53')).toMatchObject({ attempts: 1, wrong: 1 });
    expect(stats.get('i43')).toMatchObject({ attempts: 1, wrong: 1 });
    expect(stats.get('i47')).toMatchObject({ attempts: 1, wrong: 1 });
    /* 다 못 적은 칸도 정답 칸('111111')은 이미지(77·63)가 없어 통계가 없다 */
    expect(stats.size).toBe(3);
  });
});

describe('스승님 복기 입력 — 대회식 점수', () => {
  it('점수가 있는 판은 등록부의 이름·단위로 싣고, 듣기는 문항당 시간을 보내지 않는다', async () => {
    const s = session({
      eventId: 'spoken-numbers', runMode: 'real', stimulus: Array(10).fill('1'), correct: 3, wrong: 2,
      score: 4, params: { intervalMs: 1000, lang: 'ko' },
    });
    await db.recallSessions.add(s);
    await db.recallCells.bulkAdd([0, 1, 2, 3, 4].map((i) => cell(s.id, '11', i < 3 ? '11' : '12', i)));
    const input = await buildSessionReviewInput('recall', s.id);
    expect(input?.contestScore).toEqual({ label: '처음 틀린 곳까지', value: 4, unit: '자리' });
    expect(input?.secPerItem).toBeNull();
  });

  it('이진수는 줄 점수, 점수가 없는 기존 종목은 싣지 않는다', async () => {
    const b = session({ mode: 'binary', eventId: 'binary', correct: 4, wrong: 1, score: 45, params: { code: 'b3', rowLen: 30 } });
    const d = session({ eventId: 'speed-numbers', correct: 4, wrong: 1 });
    await db.recallSessions.bulkAdd([b, d]);
    expect((await buildSessionReviewInput('recall', b.id))?.contestScore).toEqual({ label: '줄 점수', value: 45, unit: '점' });
    expect(await buildSessionReviewInput('recall', d.id)).not.toHaveProperty('contestScore');
  });
});
