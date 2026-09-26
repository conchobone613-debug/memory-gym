import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ImageSet, type MemoImage } from '../db/db';
import { resolveCellImage, settingsForSession } from './resolveImage';

const set = (id: string, domain: ImageSet['domain']): ImageSet => ({ id, name: id, domain, builtin: true, createdAt: 0, updatedAt: 0 });
const img = (setId: string, key: string, name: string): MemoImage => ({ id: `${setId}:${key}`, setId, key, name, aliases: [], note: '', tags: [], updatedAt: 0 });

const sets = [set('n2', 'digit2'), set('n3', 'digit3')];
const images = [img('n2', '53', '오상'), img('n2', '43', '사상'), img('n2', '05', '공오'), img('n3', '530', '세 자리')];

describe('resolveCellImage — 이진수 칸', () => {
  it('설정 방식으로 6자리를 두 자리 숫자 이미지로 찾는다(없으면 3자리씩)', () => {
    expect(resolveCellImage('101011', 'binary', 6, DEFAULT_SETTINGS, sets, images)?.name).toBe('오상');
    expect(resolveCellImage('101011', 'binary', 6, { ...DEFAULT_SETTINGS, binaryCode: 'b6' }, sets, images)?.name).toBe('사상');
    expect(resolveCellImage('000101', 'binary', 6, { ...DEFAULT_SETTINGS, binaryCode: 'b6' }, sets, images)?.name).toBe('공오');
  });

  it('키를 못 만들거나 세트가 없으면 undefined', () => {
    expect(resolveCellImage('10101', 'binary', 6, DEFAULT_SETTINGS, sets, images)).toBeUndefined();
    expect(resolveCellImage('101011', 'binary', 6, DEFAULT_SETTINGS, [set('n3', 'digit3')], images)).toBeUndefined();
  });

  it('숫자 칸은 그대로', () => {
    expect(resolveCellImage('53', 'digits', 2, DEFAULT_SETTINGS, sets, images)?.name).toBe('오상');
    expect(resolveCellImage('530', 'digits', 3, DEFAULT_SETTINGS, sets, images)?.name).toBe('세 자리');
  });
});

describe('settingsForSession — 지난 판은 그때 방식으로', () => {
  const now = { ...DEFAULT_SETTINGS, binaryCode: 'b6' as const };

  it('이진수 판은 그 판 방식을 덮는다', () => {
    expect(settingsForSession(now, { mode: 'binary', params: { code: 'b3', rowLen: 30 } }).binaryCode).toBe('b3');
    expect(settingsForSession(DEFAULT_SETTINGS, { mode: 'binary', params: { code: 'b6', rowLen: 30 } }).binaryCode).toBe('b6');
  });

  it('방식이 없거나 모르는 값이면 지금 설정, 다른 종목은 그대로', () => {
    expect(settingsForSession(now, { mode: 'binary' })).toBe(now);
    expect(settingsForSession(now, { mode: 'binary', params: { code: 'zz' } }).binaryCode).toBe('b6');
    expect(settingsForSession(now, { mode: 'digits', params: { intervalMs: 1000, lang: 'ko' } })).toBe(now);
  });
});
