import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, db, getSettings, saveSettings, type AppSettings } from '../db/db';
import { RANKS, SUITS, SUIT_NAME, type Rank, type Suit } from '../lib/cards';
import { exportBackup, download, importBackup, pickFile } from '../lib/io';
import { Btn, Field, Panel } from '../components/ui';

export default function Settings() {
  const stored = useLiveQuery(() => getSettings(), []);
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (stored && !s) setS(stored); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;

  const commit = async (patch: Partial<AppSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    await saveSettings(patch);
    setMsg('저장됨');
  };

  const doBackup = async () =>
    download(`memory-gym-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json');

  const doRestore = async () => {
    const text = await pickFile('.json,application/json');
    if (!text) return;
    if (!confirm('현재 데이터를 모두 지우고 백업 파일로 덮어씁니다. 계속할까요?')) return;
    try {
      await importBackup(text);
      setMsg('복원 완료 — 새로고침하십시오.');
    } catch (e) {
      setMsg(`복원 실패: ${(e as Error).message}`);
    }
  };

  const wipe = async () => {
    if (!confirm('모든 이미지·기록·궁전을 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('정말 지웁니다. 백업은 받으셨습니까?')) return;
    await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
    setMsg('전체 삭제 완료 — 새로고침하면 기본 세트가 다시 생성됩니다.');
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="숫자 ↔ 자음 매핑">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.keys(s.chosungMap).sort().map((d) => (
            <Field key={d} label={`${d}`}>
              <input
                value={s.chosungMap[d]}
                onChange={(e) => setS({ ...s, chosungMap: { ...s.chosungMap, [d]: e.target.value } })}
                onBlur={() => commit({ chosungMap: s.chosungMap })}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">타이핑 검증의 초성 채점과 세트 편집기의 힌트가 이 값을 씁니다.</p>
      </Panel>

      <Panel title="카드 → 숫자 변환">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-muted">무늬</div>
            <div className="grid grid-cols-4 gap-2">
              {SUITS.map((suit: Suit) => (
                <Field key={suit} label={SUIT_NAME[suit]}>
                  <input
                    value={s.suitDigits[suit]}
                    maxLength={1}
                    onChange={(e) => setS({ ...s, suitDigits: { ...s.suitDigits, [suit]: e.target.value } })}
                    onBlur={() => commit({ suitDigits: s.suitDigits })}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">랭크 (J·Q·K 는 인물 카드라 비워 둡니다)</div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {RANKS.map((rank: Rank) => (
                <Field key={rank} label={rank}>
                  <input
                    value={s.rankDigits[rank]}
                    maxLength={1}
                    disabled={rank === 'J' || rank === 'Q' || rank === 'K'}
                    onChange={(e) => setS({ ...s, rankDigits: { ...s.rankDigits, [rank]: e.target.value } })}
                    onBlur={() => commit({ rankDigits: s.rankDigits })}
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="드릴 기본값">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="문항 수">
            <input type="number" min={5} max={300} value={s.drillCount}
              onChange={(e) => setS({ ...s, drillCount: Number(e.target.value) })}
              onBlur={() => commit({ drillCount: s.drillCount })} />
          </Field>
          <Field label="타이핑 검증 확률" hint="0.1 = 10%">
            <input type="number" min={0} max={1} step={0.05} value={s.typedCheckRate}
              onChange={(e) => setS({ ...s, typedCheckRate: Number(e.target.value) })}
              onBlur={() => commit({ typedCheckRate: s.typedCheckRate })} />
          </Field>
        </div>
      </Panel>

      <Panel title="백업">
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" onClick={doBackup}>전체 백업 내려받기</Btn>
          <Btn onClick={doRestore}>백업에서 복원</Btn>
          <Btn onClick={() => commit(DEFAULT_SETTINGS)}>매핑 기본값으로</Btn>
          <Btn variant="danger" onClick={wipe}>전체 삭제</Btn>
        </div>
        <p className="mt-2 text-xs text-muted">
          모든 데이터는 이 브라우저 안에만 있습니다. 서버로 나가지 않으니 기기를 옮기실 땐 백업 파일을 쓰십시오.
        </p>
      </Panel>

      {msg && <p className="text-xs text-accent">{msg}</p>}
    </div>
  );
}
