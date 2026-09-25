import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from './db';
import { exportBackup, importBackup } from '../lib/io';

/*
 * 기존 기록은 한 건도 잃지 않는다 (기획서 원칙 1).
 * 개편 전 앱과 똑같은 v2 모양으로 기록을 넣어 두고, 새 앱(v3)으로 열어 표마다 건수와 내용을 비교한다.
 */

const V1 = {
  imageSets: 'id, name, domain',
  images: 'id, setId, &[setId+key], name, updatedAt',
  drillSessions: 'id, startedAt',
  drillAttempts: 'id, sessionId, imageId, shownAt',
  recallSessions: 'id, startedAt, mode',
  recallCells: 'id, sessionId, [sessionId+index]',
  palaces: 'id, name',
  loci: 'id, palaceId, [palaceId+order]',
  imageStats: 'imageId, setId, medianRt, lastSeenAt',
  settings: 'key',
};
const V2 = {
  mappingSessions: 'id, startedAt, stage',
  mappingAttempts: 'id, sessionId, shownAt, unit',
  mappingStats: 'key, stage, lastSeenAt',
};

const now = Date.now();
const OLD: Record<string, Record<string, unknown>[]> = {
  imageSets: [{ id: 'set', name: '숫자 00–99', domain: 'digit2', keyGenerator: 'digits:2', builtin: true, createdAt: now, updatedAt: now }],
  images: [{ id: 'img', setId: 'set', key: '00', name: '오이', aliases: [], note: '', tags: [], updatedAt: now }],
  drillSessions: [{ id: 'ds', startedAt: now, setIds: ['set'], pickMode: 'srs', itemCount: 1, typedCheckRate: 1 }],
  drillAttempts: [{ id: 'da', sessionId: 'ds', order: 0, imageId: 'img', setId: 'set', key: '00', rtMs: 900, verdict: 'correct', shownAt: now }],
  recallSessions: [{ id: 'rs', mode: 'digits', presetName: 'p', stimulus: ['00'], memorizeMs: 1, memorizeUsedMs: 1, recallMs: 1, startedAt: now, correct: 1, wrong: 0, blank: 0 }],
  recallCells: [{ id: 'rc', sessionId: 'rs', index: 0, expected: '00', answered: '00', isCorrect: true, errorTags: [] }],
  palaces: [{ id: 'pl', name: '집', note: '', createdAt: now, updatedAt: now }],
  loci: [{ id: 'lo', palaceId: 'pl', order: 0, name: '현관', note: '' }],
  imageStats: [{ imageId: 'img', setId: 'set', attempts: 1, correct: 1, wrong: 0, rtSamples: [900], meanRt: 900, medianRt: 900, wrongStreak: 0, lastSeenAt: now }],
  settings: [{ key: 'app', chosungMap: {}, suitDigits: {}, rankDigits: {}, drillCount: 30, mappingDirection: 'toConsonant', aiKey: 'sk-secret' }],
  mappingSessions: [{ id: 'ms', stage: 1, startedAt: now, itemCount: 1 }],
  mappingAttempts: [{ id: 'ma', sessionId: 'ms', order: 0, stage: 1, unit: '7', direction: 'toConsonant', prompt: '7', answer: 'ㅅ', given: 'ㅅ', isCorrect: true, rtMs: 800, shownAt: now }],
  mappingStats: [{ key: 's1:7', stage: 1, unit: '7', attempts: 1, correct: 1, wrong: 0, rtSamples: [800], medianRt: 800, wrongStreak: 0, lastSeenAt: now }],
};

async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const name of Object.keys(OLD)) out[name] = await db.table(name).toArray();
  return out;
}

beforeAll(async () => {
  const old = new Dexie('memory-gym');
  old.version(1).stores(V1);
  old.version(2).stores(V2);
  await old.open();
  for (const [name, rows] of Object.entries(OLD)) await old.table(name).bulkAdd(rows);
  old.close();
});

describe('v2 → v3', () => {
  it('기존 13개 표가 건수와 내용까지 그대로다', async () => {
    const got = await snapshot();
    for (const [name, rows] of Object.entries(OLD)) expect(got[name], name).toEqual(rows);
    expect(db.verno).toBe(3);
  });

  it('새 표 여섯 개가 비어서 생긴다', async () => {
    for (const name of ['calcSessions', 'calcItems', 'rulesets', 'coachLogs', 'targets', 'ladderState']) {
      expect(await db.table(name).count(), name).toBe(0);
    }
  });
});

describe('백업과 복원', () => {
  it('모든 표를 내보내되 AI 키는 뺀다', async () => {
    const d = JSON.parse(await exportBackup());
    for (const t of db.tables) expect(Array.isArray(d[t.name]), t.name).toBe(true);
    expect(d.mappingAttempts).toHaveLength(1); // 개편 전에는 빠져 있던 표
    expect(JSON.stringify(d)).not.toContain('sk-secret');
  });

  it('내보낸 파일로 복원하면 그대로 돌아오고, 이 기기의 키는 남는다', async () => {
    const before = await snapshot();
    const file = await exportBackup();
    await importBackup(file);
    const after = await snapshot();
    expect(after).toEqual(before);
    expect((await db.settings.get('app'))?.aiKey).toBe('sk-secret');
  });

  it('옛 백업(자음 매핑 표가 없는 파일)으로 복원해도 자음 매핑 기록은 남는다', async () => {
    const d = JSON.parse(await exportBackup());
    delete d.mappingSessions;
    delete d.mappingAttempts;
    delete d.mappingStats;
    d.version = 1;
    await importBackup(JSON.stringify(d));
    expect(await db.mappingAttempts.count()).toBe(1);
    expect(await db.mappingSessions.count()).toBe(1);
  });
});
