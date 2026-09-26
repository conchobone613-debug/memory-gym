import { describe, expect, it } from 'vitest';
import { CALC_EVENTS, DISCIPLINES, MEMORY_EVENTS, findDiscipline } from './events';
import { PRESETS } from './presets';

describe('종목 등록부', () => {
  it('id 가 영역을 넘어서도 겹치지 않는다', () => {
    const ids = DISCIPLINES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('열린 종목은 갈 곳이, 잠긴 종목은 여는 조건이 있다', () => {
    for (const d of DISCIPLINES) {
      if (d.status === 'ready') expect(d.to, d.id).toBeTruthy();
      else expect(d.needs, d.id).toBeTruthy();
    }
  });

  it('프리셋마다 종목이 등록부에 있고, 열린 기억력 종목 주소의 프리셋은 그 종목 것이다', () => {
    for (const p of PRESETS) expect(MEMORY_EVENTS.some((e) => e.id === p.eventId), p.id).toBe(true);
    for (const e of MEMORY_EVENTS.filter((x) => x.status === 'ready')) {
      const q = new URLSearchParams(e.to!.split('?')[1]);
      expect(q.get('event'), e.id).toBe(e.id);
      expect(PRESETS.find((p) => p.id === q.get('preset'))?.eventId, e.id).toBe(e.id);
    }
  });

  it('영역 표시가 목록과 맞다', () => {
    expect(MEMORY_EVENTS.every((e) => e.domain === 'memory')).toBe(true);
    expect(CALC_EVENTS.every((e) => e.domain === 'calc')).toBe(true);
    expect(findDiscipline('calendar')?.domain).toBe('calc');
  });

  it('계산 규정의 기본값이 제 범위·선택지 안에 있다', () => {
    for (const ev of CALC_EVENTS) {
      const keys = ev.rules.map((f) => f.key);
      expect(new Set(keys).size, ev.id).toBe(keys.length);
      for (const f of ev.rules) {
        if (f.kind === 'number') {
          expect(f.default, `${ev.id}.${f.key}`).toBeGreaterThanOrEqual(f.min);
          expect(f.default, `${ev.id}.${f.key}`).toBeLessThanOrEqual(f.max);
        } else {
          expect(f.options.map((o) => o.value), `${ev.id}.${f.key}`).toContain(f.default);
        }
      }
    }
  });
});
