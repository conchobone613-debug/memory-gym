import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, ensureKeys, type ImageSet } from '../db/db';
import { uid } from '../lib/random';
import { loadStarter } from '../data/starter';
import { Btn, Empty, LinkBtn, Panel } from '../components/ui';
import { useState } from 'react';

export default function Sets() {
  const sets = useLiveQuery(() => db.imageSets.toArray(), [], [] as ImageSet[]);
  const [msg, setMsg] = useState('');
  const images = useLiveQuery(() => db.images.toArray(), [], []);

  const stat = (setId: string) => {
    const mine = images.filter((i) => i.setId === setId);
    return { total: mine.length, filled: mine.filter((i) => i.name.trim()).length };
  };

  const addSet = async (name: string, gen: ImageSet['keyGenerator'], domain: ImageSet['domain']) => {
    const t = Date.now();
    const set: ImageSet = { id: uid(), name, domain, keyGenerator: gen, builtin: false, createdAt: t, updatedAt: t };
    await db.imageSets.add(set);
    await ensureKeys(set);
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
    const s = stat(set.id);
    if (!confirm(`'${set.name}' 세트와 이미지 ${s.filled}개를 지웁니다. 계속할까요?`)) return;
    const ids = (await db.images.where('setId').equals(set.id).toArray()).map((i) => i.id);
    await db.transaction('rw', db.images, db.imageStats, db.imageSets, async () => {
      await db.images.bulkDelete(ids);
      await db.imageStats.bulkDelete(ids);
      await db.imageSets.delete(set.id);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="이미지 세트"
        right={
          <div className="flex gap-1.5">
            <Btn size="sm" variant="primary" onClick={fillStarter}>추천 이미지 불러오기</Btn>
            <Btn size="sm" onClick={() => addSet('숫자 000–999', 'digits:3', 'digit3')}>+ 3자리 숫자</Btn>
            <Btn size="sm" onClick={() => addSet('새 세트', undefined, 'custom')}>+ 빈 세트</Btn>
          </div>
        }
      >
        {sets.length === 0 ? (
          <Empty>세트가 없습니다.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {sets.map((s) => {
              const st = stat(s.id);
              const ratio = st.total ? st.filled / st.total : 0;
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel2 px-3 py-2.5">
                  <Link to={`/sets/${s.id}`} className="flex-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted">
                      {s.domain} · 채워진 이미지 {st.filled} / {st.total}
                    </div>
                  </Link>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent" style={{ width: `${ratio * 100}%` }} />
                  </div>
                  <LinkBtn to={`/sets/${s.id}`} size="sm" variant="primary">편집</LinkBtn>
                  {!s.builtin && <Btn size="sm" variant="danger" onClick={() => removeSet(s)}>삭제</Btn>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {msg && <p className="text-xs text-accent">{msg}</p>}
      <p className="text-xs text-muted">
        카드 A~10 은 숫자 세트의 이미지를 그대로 씁니다. 따로 채우실 것은 인물 12장뿐입니다.
        추천 이미지는 빈 칸에만 들어가며, 마음에 안 드는 칸은 편집에서 바꾸시면 됩니다.
      </p>
    </div>
  );
}
