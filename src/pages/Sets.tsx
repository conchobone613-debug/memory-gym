import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, ensureKeys, type ImageSet } from '../db/db';
import { uid } from '../lib/random';
import { loadStarter } from '../data/starter';
import { Btn, ConfirmBtn, Empty, LinkBtn, Panel } from '../components/ui';
import BackupNudge from '../components/BackupNudge';

export default function Sets() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const [msg, setMsg] = useState('');

  const stat = (setId: string) => {
    const mine = images.filter((i) => i.setId === setId);
    return { total: mine.length, filled: mine.filter((i) => i.name.trim()).length };
  };

  const hasDigit3 = sets.some((s) => s.domain === 'digit3');

  const addSet = async (name: string, gen: ImageSet['keyGenerator'], domain: ImageSet['domain']) => {
    /* 같은 종류의 세트를 두 벌 만들면 통계가 갈라진다. 숫자 세트는 한 벌만 허용한다. */
    if (domain !== 'custom' && sets.some((s) => s.domain === domain)) {
      setMsg(`'${name}' 세트는 이미 있습니다. 목록에서 편집하십시오.`);
      return;
    }
    const t = Date.now();
    const set: ImageSet = { id: uid(), name, domain, keyGenerator: gen, builtin: false, createdAt: t, updatedAt: t };
    await db.imageSets.add(set);
    const made = await ensureKeys(set);
    setMsg(`'${name}' 세트를 만들고 빈 키 ${made}개를 준비했습니다.`);
  };

  const fillStarter = async () => {
    const r = await loadStarter();
    setMsg(
      r.filled === 0
        ? '빈 칸이 없습니다. 이미 채워진 칸은 덮어쓰지 않습니다.'
        : `추천 이미지 ${r.filled}개를 빈 칸에 넣었습니다.${r.kept ? ` 이미 쓰시던 ${r.kept}개는 그대로 두었습니다.` : ''}`,
    );
  };

  const removeSet = async (set: ImageSet) => {
    const ids = (await db.images.where('setId').equals(set.id).toArray()).map((i) => i.id);
    await db.transaction('rw', db.images, db.imageStats, db.imageSets, async () => {
      await db.images.bulkDelete(ids);
      await db.imageStats.bulkDelete(ids);
      await db.imageSets.delete(set.id);
    });
    setMsg(`'${set.name}' 세트를 지웠습니다.`);
  };

  const rename = async (set: ImageSet, name: string) => {
    const next = name.trim();
    if (!next || next === set.name) return;
    await db.imageSets.update(set.id, { name: next, updatedAt: Date.now() });
  };

  return (
    <div className="flex flex-col gap-4">
      <BackupNudge />
      <Panel
        title="이미지 세트"
        right={
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" variant="primary" onClick={fillStarter}>추천 이미지 112개 채우기</Btn>
            <Btn size="sm" disabled={hasDigit3} onClick={() => addSet('숫자 000–999', 'digits:3', 'digit3')}>
              + 3자리 숫자
            </Btn>
            <Btn size="sm" onClick={() => addSet('새 세트', undefined, 'custom')}>+ 빈 세트</Btn>
          </div>
        }
      >
        <p className="mb-3 text-xs text-muted">
          <b className="text-fg">추천 이미지 112개 채우기</b> — 숫자 00–99 와 인물 카드 12장에 제가 고른 이미지를
          한 번에 넣습니다. <b className="text-fg">비어 있는 칸에만</b> 들어가고 회장님이 직접 쓰신 칸은 건드리지
          않습니다. 마음에 안 드는 칸은 편집에서 바꾸시면 됩니다.
        </p>
        <p className="mb-3 rounded-lg border border-line/70 px-3 py-2 text-xs text-muted">
          이미지는 <b className="text-fg">브라우저마다 따로</b> 저장됩니다. 다른 기기나 다른 브라우저에서 열면
          빈 칸으로 시작하는 것이 정상입니다. 옮기실 땐 설정의 백업 파일을 쓰시거나, 위 버튼으로 추천 목록을
          다시 넣으십시오.
        </p>

        {sets.length === 0 ? (
          <Empty>세트가 없습니다.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {sets.map((s) => {
              const st = stat(s.id);
              const ratio = st.total ? st.filled / st.total : 0;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2.5">
                  <div className="min-w-40 flex-1">
                    <input
                      defaultValue={s.name}
                      onBlur={(e) => rename(s, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className="w-full font-medium"
                      aria-label="세트 이름"
                    />
                    <Link to={`/assets/sets/${s.id}`} className="text-xs text-muted hover:text-accent">
                      {s.domain} · 채워진 이미지 {st.filled} / {st.total}
                    </Link>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent" style={{ width: `${ratio * 100}%` }} />
                  </div>
                  <LinkBtn to={`/assets/sets/${s.id}`} size="sm" variant="primary">편집</LinkBtn>
                  {!s.builtin && (
                    <ConfirmBtn
                      size="sm"
                      label="삭제"
                      confirmLabel={`'${s.name}' 과 채운 이미지 ${st.filled}개가 사라집니다`}
                      onConfirm={() => removeSet(s)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {msg && <p className="text-xs text-accent">{msg}</p>}
      <p className="text-xs text-muted">
        카드 A~10 은 숫자 세트의 이미지를 그대로 씁니다. 따로 채우실 것은 인물 12장뿐입니다.
      </p>
    </div>
  );
}
