import { useEffect, useState } from 'react';
import { CALC_EVENTS, type CalcEvent } from '../data/events';
import type { RuleValues } from '../db/db';
import { clampRule, getRules, resetRules, saveRules } from '../lib/rules';
import { Btn, Field } from './ui';
import { Folder } from './lp';

/**
 * 대회 규정. 공식 규정은 해마다 바뀌므로 회장이 확인해 여기서 덮어쓴다(기획서 §5.1).
 * 세션은 시작할 때 이 값을 사본으로 가져가므로, 바꿔도 옛 기록의 뜻은 그대로다.
 * 설정 화면에서 자기 서류철을 스스로 그린다(설정이 감싸면 서류철 안에 서류철이 된다).
 */
export default function RulesPanel() {
  return (
    <Folder tab="계산 규정">
      <p className="mb-3 font-typek text-[12px] leading-relaxed text-ink-2">
        기본값은 요청서 값입니다. 공식 규정을 확인하시면 여기서 바꾸십시오. 제한시간 0 은 아직 넣지 않았다는 뜻입니다.
      </p>
      <div className="flex flex-col gap-2">
        {CALC_EVENTS.map((ev) => <EventRules key={ev.id} ev={ev} />)}
      </div>
    </Folder>
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
    <details className="rounded-[4px] bg-card px-3 py-2 shadow-[var(--paper-lift)]">
      <summary className="cursor-pointer py-1 font-sign text-[17px] text-ink">{ev.name}</summary>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {ev.rules.map((f) => (
          <Field key={f.key} label={f.kind === 'number' && f.unit ? `${f.label} (${f.unit})` : f.label} hint={f.hint}>
            {f.kind === 'number' ? (
              <input
                type="number" inputMode="numeric" min={f.min} max={f.max} className="w-full min-w-0"
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                onBlur={() => commit(v)}
              />
            ) : (
              <select className="w-full min-w-0" value={v[f.key]} onChange={(e) => commit({ ...v, [f.key]: e.target.value })}>
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
        {msg && <span className="font-typek text-[12px] text-chalk" role="status">{msg}</span>}
      </div>
    </details>
  );
}
