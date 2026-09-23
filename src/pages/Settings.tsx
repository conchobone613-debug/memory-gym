import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, db, getSettings, saveSettings, type AppSettings } from '../db/db';
import { RANKS, SUITS, SUIT_NAME, type Rank, type Suit } from '../lib/cards';
import { exportBackup, download, importBackup, pickFile } from '../lib/io';
import { askForNames } from '../lib/ai';
import { Btn, ConfirmBtn, Field, Panel } from '../components/ui';
import ChosungKey from '../components/ChosungKey';
import SyncPanel from '../components/SyncPanel';
import { useSearchParams } from 'react-router-dom';
import { isValidSyncCode } from '../sync/config';

export default function Settings() {
  const stored = useLiveQuery(() => getSettings(), []);
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [params, setParams] = useSearchParams();

  /* 다른 기기에서 보낸 주소로 열면 코드를 자동으로 넣어 준다 */
  useEffect(() => {
    const c = params.get('sync');
    if (!c) return;
    setParams({}, { replace: true });
    if (isValidSyncCode(c)) saveSettings({ syncCode: c.toLowerCase(), lastSyncAt: 0 }).then(() => setMsg('동기화 코드를 넣었습니다. 아래에서 지금 맞추기를 누르십시오.'));
    else setMsg('주소에 담긴 동기화 코드 형식이 올바르지 않습니다.');
  }, [params, setParams]);

  useEffect(() => { if (stored && !s) setS(stored); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 키가 진짜 도는지 한 번 불러 본다. 나중에 후보 화면에서 처음 실패하는 것보다 낫다. */
  const testAi = async () => {
    if (!s?.aiKey) return;
    setAiTesting(true);
    setAiMsg('');
    try {
      await saveSettings({ aiKey: s.aiKey.trim() });
      const got = await askForNames({
        apiKey: s.aiKey.trim(), key: '12', isFace: false, map: s.chosungMap, exclude: [], count: 3,
      });
      setAiMsg(got.length ? `됩니다. 시험 삼아 받은 후보 — ${got.join(', ')}` : '연결은 됐는데 쓸 만한 후보가 안 왔습니다. 다시 눌러 보십시오.');
    } catch (e) {
      setAiMsg(`안 됩니다 — ${(e as Error).message}`);
    } finally {
      setAiTesting(false);
    }
  };

  if (!s) return null;

  const commit = async (patch: Partial<AppSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    await saveSettings(patch);
    setMsg('저장됨');
  };

  const doBackup = async () => {
    download(`memory-gym-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json');
    await commit({ lastBackupAt: Date.now() });
    setMsg('백업 파일을 내려받았습니다.');
  };

  const doRestore = async () => {
    const text = await pickFile('.json,application/json');
    if (!text) return;
    try {
      await importBackup(text);
      setMsg('복원 완료 — 새로고침하십시오.');
    } catch (e) {
      setMsg(`복원 실패: ${(e as Error).message}`);
    }
  };

  const wipe = async () => {
    await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
    setMsg('전체 삭제 완료 — 새로고침하면 기본 세트가 다시 생성됩니다.');
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="숫자 ↔ 자음 매핑">
        <div className="mb-4">
          <ChosungKey map={s.chosungMap} />
        </div>
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
        </div>
      </Panel>

      <Panel title="AI 이름 후보">
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Anthropic API 키"
            hint="이 브라우저에만 저장됩니다. 기기 동기화에도 올라가지 않습니다."
          >
            <input
              type="password"
              value={s.aiKey ?? ''}
              onChange={(e) => setS({ ...s, aiKey: e.target.value.trim() })}
              onBlur={() => commit({ aiKey: s.aiKey?.trim() || undefined })}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Btn disabled={!s.aiKey || aiTesting} onClick={testAi}>
              {aiTesting ? '확인 중…' : '연결 확인'}
            </Btn>
            {s.aiKey && (
              <ConfirmBtn
                label="키 지우기"
                confirmLabel="이 브라우저에서 키를 지웁니다"
                onConfirm={async () => { setS({ ...s, aiKey: undefined }); await commit({ aiKey: undefined }); setAiMsg(''); }}
              />
            )}
          </div>
        </div>
        {aiMsg && <p className="mt-3 text-xs text-accent">{aiMsg}</p>}
        <p className="mt-3 text-xs text-muted">
          키를 넣으시면 이름 후보의 '다른 후보' 가 누를 때마다 새로 지어 옵니다. 안 넣으셔도
          지금처럼 사전 후보로 돌아갑니다.
        </p>
      </Panel>

      <SyncPanel />

      <Panel title="백업">
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={doBackup}>전체 백업 내려받기</Btn>
          <Btn onClick={doRestore}>백업에서 복원</Btn>
          <Btn onClick={() => commit(DEFAULT_SETTINGS)}>매핑 기본값으로</Btn>
          <ConfirmBtn
            label="전체 삭제"
            confirmLabel="이미지·기록·궁전이 모두 사라지고 되돌릴 수 없습니다"
            onConfirm={wipe}
          />
        </div>
        <p className="mt-2 text-xs text-warn">
          '백업에서 복원' 은 파일을 고르는 즉시 현재 데이터를 덮어씁니다. 먼저 백업을 받아 두십시오.
        </p>
        <p className="mt-2 text-xs text-muted">
          모든 데이터는 이 브라우저 안에만 있습니다. 서버로 나가지 않으니 기기를 옮기실 땐 백업 파일을 쓰십시오.
        </p>
      </Panel>

      {msg && <p className="text-xs text-accent">{msg}</p>}
    </div>
  );
}
