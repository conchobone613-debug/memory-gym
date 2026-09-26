import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, db, getSettings, saveSettings, type AppSettings } from '../db/db';
import { RANKS, SUITS, SUIT_NAME, type Rank, type Suit } from '../lib/cards';
import { exportBackup, download, importBackup, pickFile } from '../lib/io';
import { askForNames } from '../lib/ai';
import { AUTO_CALL_CAP, PRICE_PER_M, usageThisMonth } from '../coach';
import { Btn, ConfirmBtn, Field } from '../components/ui';
import { Dymo, Folder } from '../components/lp';
import ChosungKey from '../components/ChosungKey';
import SyncPanel from '../components/SyncPanel';
import RulesPanel from '../components/RulesPanel';
import { useSearchParams } from 'react-router-dom';
import { isValidSyncCode } from '../sync/config';

/*
 * 설정 — 구역마다 서류철 하나. 서류철 안에 서류철을 넣지 않으므로
 * 규정(RulesPanel)·동기화(SyncPanel)는 각자 자기 서류철을 그리고, 여기서 감싸지 않는다.
 */

/** 좁은 칸(한 글자·자음 셋)은 안쪽 여백을 줄여 글자가 잘리지 않게 한다. 입력칸 기본 모양이 index.css 에 있어 인라인으로 준다. */
const narrow = { padding: '.4rem .2rem' };
const note = 'font-typek text-[12px] leading-relaxed text-ink-2';
/** 알림 한 줄. 실패·형식 오류(ok=false)는 성공색(chalk) 대신 굵은 잉크로 칠한다. */
type Msg = { t: string; ok: boolean };
const msgCls = (m: Msg) => (m.ok ? 'text-chalk' : 'font-bold text-ink');

export default function Settings() {
  const stored = useLiveQuery(() => getSettings(), []);
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiMsg, setAiMsg] = useState<Msg | null>(null);
  const [params, setParams] = useSearchParams();
  /* 이번 달 스승님 사용량 — coachLogs 의 토큰으로 코드가 센다(이름 후보 호출은 들어가지 않는다) */
  const usage = useLiveQuery(() => usageThisMonth(), []);

  /* 다른 기기에서 보낸 주소로 열면 코드를 자동으로 넣어 준다 */
  useEffect(() => {
    const c = params.get('sync');
    if (!c) return;
    setParams({}, { replace: true });
    if (isValidSyncCode(c)) saveSettings({ syncCode: c.toLowerCase(), lastSyncAt: 0 }).then(() => setMsg({ t: '동기화 코드를 넣었습니다. 아래에서 지금 맞추기를 누르십시오.', ok: true }));
    else setMsg({ t: '주소에 담긴 동기화 코드 형식이 올바르지 않습니다.', ok: false });
  }, [params, setParams]);

  useEffect(() => { if (stored && !s) setS(stored); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 종목 화면의 '규정 바꾸기' 로 오면 그 칸으로 내려 준다 */
  const at = params.get('at');
  useEffect(() => {
    if (s && at) document.getElementById(at)?.scrollIntoView({ block: 'start' });
  }, [s, at]);

  /** 키가 진짜 도는지 한 번 불러 본다. 나중에 후보 화면에서 처음 실패하는 것보다 낫다. */
  const testAi = async () => {
    if (!s?.aiKey) return;
    setAiTesting(true);
    setAiMsg(null);
    try {
      await saveSettings({ aiKey: s.aiKey.trim() });
      const { names, raw } = await askForNames({
        apiKey: s.aiKey.trim(), key: '12', isFace: false, map: s.chosungMap, exclude: [], count: 3,
      });
      setAiMsg(
        names.length
          ? { t: `됩니다. 시험 삼아 받은 후보 — ${names.join(', ')}`, ok: true }
          : { t: `연결은 됐는데 두 번 청해도 규칙에 맞는 후보가 안 왔습니다. 받은 것 — ${raw.replace(/\s+/g, ' ').slice(0, 60)}`, ok: false },
      );
    } catch (e) {
      setAiMsg({ t: `안 됩니다 — ${(e as Error).message}`, ok: false });
    } finally {
      setAiTesting(false);
    }
  };

  if (!s) return null;

  const commit = async (patch: Partial<AppSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    await saveSettings(patch);
    setMsg({ t: '저장됨', ok: true });
  };

  const doBackup = async () => {
    download(`memory-gym-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json');
    await commit({ lastBackupAt: Date.now() });
    setMsg({ t: '백업 파일을 내려받았습니다.', ok: true });
  };

  const doRestore = async () => {
    const text = await pickFile('.json,application/json');
    if (!text) return;
    try {
      await importBackup(text);
      setMsg({ t: '복원 완료 — 새로고침하십시오.', ok: true });
    } catch (e) {
      setMsg({ t: `복원 실패: ${(e as Error).message}`, ok: false });
    }
  };

  const wipe = async () => {
    await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
    setMsg({ t: '전체 삭제 완료 — 새로고침하면 기본 세트가 다시 생성됩니다.', ok: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <Dymo className="self-start">설정</Dymo>

      <Folder tab="자음 매핑" clip>
        <div className="mb-3">
          <ChosungKey map={s.chosungMap} />
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {Object.keys(s.chosungMap).sort().map((d) => (
            <Field key={d} label={`${d}`}>
              <input
                value={s.chosungMap[d]}
                className="w-full min-w-0 text-center"
                style={narrow}
                onChange={(e) => setS({ ...s, chosungMap: { ...s.chosungMap, [d]: e.target.value } })}
                onBlur={() => commit({ chosungMap: s.chosungMap })}
              />
            </Field>
          ))}
        </div>
        <p className={`mt-2 ${note}`}>타이핑 검증의 초성 채점과 세트 편집기의 힌트가 이 값을 씁니다.</p>
      </Folder>

      <Folder tab="카드 변환">
        <div className="flex flex-col gap-3">
          <div>
            <div className={`mb-1 ${note}`}>무늬</div>
            <div className="grid grid-cols-4 gap-2">
              {SUITS.map((suit: Suit) => (
                <Field key={suit} label={SUIT_NAME[suit]}>
                  <input
                    value={s.suitDigits[suit]}
                    maxLength={1}
                    className="w-full min-w-0 text-center"
                    onChange={(e) => setS({ ...s, suitDigits: { ...s.suitDigits, [suit]: e.target.value } })}
                    onBlur={() => commit({ suitDigits: s.suitDigits })}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div>
            <div className={`mb-1 ${note}`}>랭크 (J·Q·K 는 인물 카드라 비워 둡니다)</div>
            <div className="grid grid-cols-7 gap-1.5">
              {RANKS.map((rank: Rank) => (
                <Field key={rank} label={rank}>
                  <input
                    value={s.rankDigits[rank]}
                    maxLength={1}
                    className="w-full min-w-0 text-center"
                    style={narrow}
                    disabled={rank === 'J' || rank === 'Q' || rank === 'K'}
                    onChange={(e) => setS({ ...s, rankDigits: { ...s.rankDigits, [rank]: e.target.value } })}
                    onBlur={() => commit({ rankDigits: s.rankDigits })}
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </Folder>

      <Folder tab="훈련 기본값">
        <div className="grid grid-cols-2 gap-3">
          <Field label="드릴 문항 수">
            <input type="number" min={5} max={300} value={s.drillCount} className="w-full min-w-0"
              onChange={(e) => setS({ ...s, drillCount: Number(e.target.value) })}
              onBlur={() => commit({ drillCount: s.drillCount })} />
          </Field>
          <Field label="하루 목표 (분)" hint="홈의 '오늘 채운 시간' 이 이 값을 봅니다.">
            <input type="number" inputMode="numeric" min={1} max={600} value={s.dailyMinutes} className="w-full min-w-0"
              onChange={(e) => setS({ ...s, dailyMinutes: Number(e.target.value) })}
              onBlur={() => commit({ dailyMinutes: Math.min(600, Math.max(1, Math.round(s.dailyMinutes) || 15)) })} />
          </Field>
        </div>
      </Folder>

      <Folder tab="화면과 소리">
        <div className="grid grid-cols-2 gap-3">
          <Field label="움직임 줄이기">
            <select
              className="w-full min-w-0"
              value={s.reduceMotion === undefined ? 'device' : s.reduceMotion ? 'on' : 'off'}
              onChange={(e) => commit({ reduceMotion: e.target.value === 'device' ? undefined : e.target.value === 'on' })}
            >
              <option value="device">기기 설정 따름</option>
              <option value="on">줄임</option>
              <option value="off">줄이지 않음</option>
            </select>
          </Field>
          <Field label="효과음" hint="위 머리말의 종 모양으로도 켜고 끕니다.">
            <select className="w-full min-w-0" value={s.soundOn === false ? 'off' : 'on'} onChange={(e) => commit({ soundOn: e.target.value === 'on' })}>
              <option value="on">켬</option>
              <option value="off">끔</option>
            </select>
          </Field>
        </div>
      </Folder>

      <div id="rules" className="scroll-mt-20"><RulesPanel /></div>

      <Folder tab="AI 스승님">
        <div className="flex flex-col gap-3">
          <Field
            label="Anthropic API 키"
            hint="이 브라우저에만 저장됩니다. 기기 동기화와 백업 파일에도 들어가지 않습니다."
          >
            <input
              type="password"
              className="w-full min-w-0"
              value={s.aiKey ?? ''}
              onChange={(e) => setS({ ...s, aiKey: e.target.value.trim() })}
              onBlur={() => commit({ aiKey: s.aiKey?.trim() || undefined })}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Btn disabled={!s.aiKey || aiTesting} onClick={testAi}>
              {aiTesting ? '확인 중…' : '연결 확인'}
            </Btn>
            {s.aiKey && (
              <ConfirmBtn
                label="키 지우기"
                confirmLabel="이 브라우저에서 키를 지웁니다"
                onConfirm={async () => { setS({ ...s, aiKey: undefined }); await commit({ aiKey: undefined }); setAiMsg(null); }}
              />
            )}
          </div>
        </div>
        {aiMsg && <p className={`mt-3 font-typek text-[12px] ${msgCls(aiMsg)}`} role="status">{aiMsg.t}</p>}

        <label className="mt-4 flex items-start gap-2 font-typek text-[13px] text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0"
            checked={s.coachAuto !== false}
            onChange={(e) => commit({ coachAuto: e.target.checked })}
          />
          <span>홈을 열 때 하루 한 번 코스 짜기</span>
        </label>

        <div className="mt-3 rounded-[4px] bg-card px-3 py-2.5 font-typek text-[12px] leading-relaxed text-ink">
          <div className="font-bold">이번 달 사용량</div>
          {usage ? (
            <span className="tnum">
              호출 {usage.calls}회 · 토큰 {(usage.inputTokens + usage.outputTokens).toLocaleString('ko-KR')}
              {' '}(입력 {usage.inputTokens.toLocaleString('ko-KR')} · 출력 {usage.outputTokens.toLocaleString('ko-KR')})
              {' '}· 약 ${usage.usd > 0 && usage.usd < 0.01 ? '0.01 미만' : usage.usd.toFixed(2)}
            </span>
          ) : '—'}
          <div className={`mt-1 ${usage && usage.calls >= AUTO_CALL_CAP ? 'font-bold text-ink' : 'text-ink-2'}`}>
            {usage && usage.calls >= AUTO_CALL_CAP
              ? `이번 달 호출이 ${AUTO_CALL_CAP}회에 이르러 하루 한 번 자동 코스를 멈췄습니다. 다음 달 1일에 다시 켜집니다.`
              : `안전판 — 이번 달 호출이 ${AUTO_CALL_CAP}회에 이르면 자동 코스를 멈춥니다. 직접 누르는 코스·복기·주간 리뷰는 막지 않습니다.`}
          </div>
        </div>

        <p className={`mt-3 ${note}`}>
          키를 넣으시면 스승님이 기록 요약을 읽고 오늘의 코스와 한 판 복기를 짜 드리고, 이름 후보의 '다른 후보' 도
          새로 지어 옵니다. 안 넣으셔도 규칙으로 짠 코스와 사전 후보로 돌아갑니다. 사용량은 이 기기에서 부른 스승님 호출(코스·복기·주간 리뷰)만 세며
          값은 입력 백만 토큰당 {PRICE_PER_M.input}달러 · 출력 {PRICE_PER_M.output}달러로 어림한 것입니다.
        </p>
      </Folder>

      <SyncPanel />

      <Folder tab="백업">
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
        <p className="mt-3 font-typek text-[12px] font-bold leading-relaxed text-ink">
          '백업에서 복원' 은 파일을 고르는 즉시 현재 데이터를 덮어씁니다. 먼저 백업을 받아 두십시오.
        </p>
        <p className={`mt-2 ${note}`}>
          모든 데이터는 이 브라우저 안에만 있습니다. 서버로 나가지 않으니 기기를 옮기실 땐 백업 파일을 쓰십시오.
        </p>
      </Folder>

      {msg && <p className={`font-typek text-[12px] ${msgCls(msg)}`} role="status">{msg.t}</p>}
    </div>
  );
}
