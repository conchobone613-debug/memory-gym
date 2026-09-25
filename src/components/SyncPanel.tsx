import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings, saveSettings } from '../db/db';
import { isValidSyncCode, newSyncCode } from '../sync/config';
import { syncOnce } from '../sync/engine';
import { Btn, ConfirmBtn, Field } from './ui';
import { Folder } from './lp';

/** 알림 한 줄. 실패·형식 오류(ok=false)는 성공색(chalk) 대신 굵은 잉크로 칠한다. */
type Msg = { t: string; ok: boolean };

const fmt = (t?: number) =>
  t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '없음';

/**
 * 기기 간 동기화.
 * 로그인이 없다. 코드 하나가 방 하나이고, 그 코드를 다른 기기에 옮기면 같은 방을 쓴다.
 * 설정 화면에서 자기 서류철을 스스로 그린다(설정이 감싸면 서류철 안에 서류철이 된다).
 */
export default function SyncPanel() {
  const settings = useLiveQuery(() => getSettings(), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [entering, setEntering] = useState(false);
  const [entered, setEntered] = useState('');

  if (!settings) return null;
  const code = settings.syncCode;

  const run = async (c: string) => {
    setBusy(true);
    setMsg({ t: '맞추는 중…', ok: true });
    try {
      /* Firebase SDK 는 여기서만 받는다. 동기화를 안 쓰시면 내려받지도 않는다. */
      const { firestoreRemote } = await import('../sync/firestore');
      const r = await syncOnce(firestoreRemote(c));
      setMsg({
        t: `맞췄습니다 — 올린 기록 ${r.pushed}개, 받은 기록 ${r.pulled}개` +
          (r.assets === 'remote' ? ' · 이미지·궁전을 다른 기기 것과 합쳤습니다' : ''),
        ok: true,
      });
    } catch (e) {
      setMsg({ t: `실패: ${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const c = newSyncCode();
    await saveSettings({ syncCode: c, lastSyncAt: 0 });
    await run(c);
  };

  const join = async () => {
    const c = entered.trim().toLowerCase();
    if (!isValidSyncCode(c)) { setMsg({ t: '코드가 32자리 형식이 아닙니다. 다시 확인해 주십시오.', ok: false }); return; }
    await saveSettings({ syncCode: c, lastSyncAt: 0 });
    setEntering(false);
    setEntered('');
    await run(c);
  };

  const stop = async () => {
    await saveSettings({ syncCode: undefined, lastSyncAt: 0 });
    setMsg({ t: '이 기기에서 동기화를 껐습니다. 기록은 그대로 남아 있습니다.', ok: true });
  };

  const link = code ? `${location.origin}${location.pathname}#/settings?sync=${code}` : '';

  return (
    <Folder tab="기기 동기화">
      {!code ? (
        <>
          <p className="text-[14px] leading-relaxed text-ink-2">
            여러 PC·휴대폰에서 같은 기록을 보시려면 여기서 켜십시오. 로그인은 없습니다.
            <b className="text-ink"> 첫 기기에서 '동기화 시작'</b>을 누르시고, 나온 코드를 다른 기기에 넣으시면 됩니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="primary" disabled={busy} onClick={start}>동기화 시작 (이 기기 기준)</Btn>
            <Btn disabled={busy} onClick={() => setEntering((v) => !v)}>다른 기기 코드 넣기</Btn>
          </div>
          {entering && (
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label="동기화 코드 32자리">
                  <input
                    value={entered}
                    onChange={(e) => setEntered(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
                    placeholder="예: 3f9c1a…"
                    className="w-full min-w-0"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <Btn variant="primary" disabled={busy} onClick={join}>연결</Btn>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <Field label="이 기기의 동기화 코드" hint="다른 기기에서 '다른 기기 코드 넣기'에 그대로 붙이십시오">
              <input readOnly value={code} onFocus={(e) => e.currentTarget.select()} className="w-full min-w-0" />
            </Field>
            <Field label="다른 기기에서 열 주소" hint="휴대폰으로 이 주소를 열면 코드가 자동으로 들어갑니다">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full min-w-0" />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn variant="primary" disabled={busy} onClick={() => run(code)}>지금 맞추기</Btn>
            <Btn
              disabled={busy}
              onClick={() => { navigator.clipboard?.writeText(code); setMsg({ t: '코드를 복사했습니다.', ok: true }); }}
            >
              코드 복사
            </Btn>
            <ConfirmBtn
              size="md"
              label="이 기기에서 끄기"
              confirmLabel="이 기기만 동기화를 멈춥니다 (기록은 안 지웁니다)"
              onConfirm={stop}
            />
          </div>
          <p className="mt-2 font-typek text-[12px] text-ink-2">
            마지막 동기화 <span className="tnum text-ink">{fmt(settings.lastSyncAt)}</span>
          </p>
        </>
      )}

      {msg && <p className={`mt-3 font-typek text-[12px] ${msg.ok ? 'text-chalk' : 'font-bold text-ink'}`} role="status">{msg.t}</p>}

      <p className="mt-3 font-typek text-[12px] leading-relaxed text-ink-2">
        기록은 코드를 아는 사람만 읽을 수 있습니다. 코드는 128비트 난수라 찍어서 맞힐 수 없고,
        목록으로 훑는 것도 막아 두었습니다. 올라가는 것은 이미지 이름과 반응시간뿐이며 신원 정보는 없습니다.
      </p>
    </Folder>
  );
}
