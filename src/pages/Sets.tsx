import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureKeys, type ImageSet } from '../db/db';
import { uid } from '../lib/random';
import { loadStarter } from '../data/starter';
import { ConfirmBtn, Empty } from '../components/ui';
import { Dymo, Folder, IndexCard, Key, KeyLink } from '../components/lp';
import BackupNudge from '../components/BackupNudge';

/** 세트 종류를 화면 글로. 저장값(domain)은 그대로 둔다. */
const DOMAIN_LABEL: Record<ImageSet['domain'], string> = {
  digit2: '두 자리 숫자 00–99',
  digit3: '세 자리 숫자 000–999',
  cardFace: '인물 카드 12장',
  card2: '카드 두 장 묶음',
  custom: '직접 만든 세트',
};

export default function Sets() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const images = useLiveQuery(() => db.images.toArray(), [], []);
  const [msg, setMsg] = useState('');
  /** 이름을 고치는 중인 세트. 목록 카드의 제목은 간판 글씨로 두고, 고칠 때만 입력칸을 연다. */
  const [renaming, setRenaming] = useState<string | null>(null);

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

      <header>
        <h1 className="m-0 font-sign text-[40px] leading-none text-ink">이미지 세트</h1>
        <p className="m-0 mt-1.5 font-typek text-[12px] font-bold text-ink-2">숫자와 카드를 무엇으로 볼지 정해 두는 곳</p>
      </header>

      <Folder tab="추천 이미지">
        <p className="m-0 font-body text-[13px] leading-[1.55] text-ink">
          숫자 00–99 와 인물 카드 12장에 제가 고른 이미지를 한 번에 넣습니다. <b>비어 있는 칸에만</b> 들어가고
          회장님이 직접 쓰신 칸은 건드리지 않습니다. 마음에 안 드는 칸은 편집에서 바꾸시면 됩니다.
        </p>
        <Key tone="cream" size="big" className="mt-4" onClick={fillStarter}>추천 이미지 112개 채우기</Key>
        <p className="m-0 mt-4 font-typek text-[11px] leading-[1.5] text-ink-2">
          이미지는 <b className="text-ink">브라우저마다 따로</b> 저장됩니다. 다른 기기나 다른 브라우저에서 열면
          빈 칸으로 시작하는 것이 정상입니다. 옮기실 땐 설정의 백업 파일을 쓰시거나, 위 버튼으로 추천 목록을
          다시 넣으십시오.
        </p>
      </Folder>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <Dymo small>내 세트</Dymo>
        <span className="flex flex-wrap gap-2.5">
          <Key tone="cream" size="sm" disabled={hasDigit3} onClick={() => addSet('숫자 000–999', 'digits:3', 'digit3')}>
            + 3자리 숫자
          </Key>
          <Key tone="cream" size="sm" onClick={() => addSet('새 세트', undefined, 'custom')}>+ 빈 세트</Key>
        </span>
      </div>

      {msg && <p role="status" className="m-0 font-typek text-[12px] text-ink">{msg}</p>}

      {sets.length === 0 ? (
        <Empty>세트가 없습니다.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {sets.map((s) => {
            const st = stat(s.id);
            const empty = st.total - st.filled;
            return (
              <IndexCard
                key={s.id}
                title={s.name}
                meta={`${st.filled}/${st.total}`}
                body={`${DOMAIN_LABEL[s.domain]} · ${st.total === 0 ? '키가 없습니다' : empty ? `빈 칸 ${empty}개` : '다 채웠습니다'}`}
              >
                {renaming === s.id && (
                  <input
                    autoFocus
                    defaultValue={s.name}
                    onBlur={(e) => { rename(s, e.target.value); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="mt-2 w-full"
                    aria-label="세트 이름"
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <KeyLink to={`/assets/sets/${s.id}`} size="sm">편집</KeyLink>
                  {renaming !== s.id && (
                    <Key tone="cream" size="sm" onClick={() => setRenaming(s.id)}>이름 바꾸기</Key>
                  )}
                  {!s.builtin && (
                    <ConfirmBtn
                      size="sm"
                      label="삭제"
                      confirmLabel={`'${s.name}' 과 채운 이미지 ${st.filled}개가 사라집니다`}
                      onConfirm={() => removeSet(s)}
                    />
                  )}
                </div>
              </IndexCard>
            );
          })}
        </div>
      )}

      <p className="m-0 font-typek text-[11px] text-ink-2">
        카드 A~10 은 숫자 세트의 이미지를 그대로 씁니다. 따로 채우실 것은 인물 12장뿐입니다.
      </p>
    </div>
  );
}
