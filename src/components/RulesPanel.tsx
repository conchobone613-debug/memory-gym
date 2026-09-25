import { useEffect, useState } from 'react';
import { CALC_EVENTS, type CalcEvent } from '../data/events';
import type { RuleValues } from '../db/db';
import { clampRule, getRules, resetRules, saveRules } from '../lib/rules';
import { Btn, Field, Panel } from './ui';

/**
 * 대회 규정. 공식 규정은 해마다 바뀌므로 회장이 확인해 여기서 덮어쓴다(기획서 §5.1).
 * 세션은 시작할 때 이 값을 사본으로 가져가므로, 바꿔도 옛 기록의 뜻은 그대로다.
 */
export default function RulesPanel() {
  return (
    <Panel title="대회 규정 · 계산">
      <p className="mb-3 text-xs text-muted">
        기본값은 요청서 값입니다. 공식 규정을 확인하시면 여기서 바꾸십시오. 제한시간 0 은 아직 넣지 않았다는 뜻입니다.
      </p>
      <div className="flex flex-col gap-2">
        {CALC_EVENTS.map((ev) => <EventRules key={ev.id} ev={ev} />)}
      </div>
    </Panel>
  );
}

function EventRules({ ev }: { ev: CalcEvent }) {
  const [v, setV] = useState<RuleValues | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { getRules(ev).then(setV); }, [ev]);
  if (!v) return null;

  const commit = async (next: RuleValues) => {
    const fixed = Object.fromEntries(ev.rules.map((f) => [f.key, clampRule(f, next[f.key])]));
    setV(fixed);
    await saveRules(ev, fixed);
    setMsg('저장됨');
  };

  return (
    <details className="rounded-lg border border-line/70 px-3 py-2">
      <summary className="cursor-pointer py-1 text-sm">{ev.name}</summary>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
        {ev.rules.map((f) => (
          <Field key={f.key} label={f.kind === 'number' && f.unit ? `${f.label} (${f.unit})` : f.label} hint={f.hint}>
            {f.kind === 'number' ? (
              <input
                type="number" inputMode="numeric" min={f.min} max={f.max}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                onBlur={() => commit(v)}
              />
            ) : (
              <select value={v[f.key]} onChange={(e) => commit({ ...v, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </Field>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Btn size="sm" onClick={async () => { await resetRules(ev); setV(await getRules(ev)); setMsg('기본값으로 되돌렸습니다'); }}>
          기본값으로
        </Btn>
        {msg && <span className="text-xs text-accent">{msg}</span>}
      </div>
    </details>
  );
}
