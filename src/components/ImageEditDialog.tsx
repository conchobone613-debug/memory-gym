import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, type MemoImage } from '../db/db';
import { cardLabel } from '../lib/cards';
import { suggestFor } from '../lib/suggest';
import ImageFields from './ImageFields';
import { Folder, Key } from './lp';

/**
 * 이미지 한 칸을 그 자리에서 고치는 팝업.
 *
 * 드릴 결과에서 틀린 줄을 보다가 "이 이름이 안 붙는다" 를 깨닫는다. 그때 세트 편집기까지
 * 가라고 하면 그 순간을 놓치고, 표 안 좁은 칸에 이름만 치게 하면 별칭·묘사는 못 고친다.
 * 그래서 편집기와 **같은 상자**(`ImageFields`)를 띄운다.
 */
export default function ImageEditDialog({ imageId, onClose }: { imageId: string; onClose: () => void }) {
  const image = useLiveQuery(() => db.images.get(imageId), [imageId]);
  const siblings = useLiveQuery(
    async (): Promise<MemoImage[]> => (image ? db.images.where('setId').equals(image.setId).toArray() : []),
    [image?.setId],
    [] as MemoImage[],
  );
  const set = useLiveQuery(() => (image ? db.imageSets.get(image.setId) : undefined), [image?.setId]);
  const settings = useLiveQuery(() => getSettings(), []);

  const [draft, setDraft] = useState<MemoImage | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(image ? { ...image } : null); }, [image?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * 세트·설정이 늦게 오면 그 전까지 상자 자체가 안 그려진다. draft 만 보고 포커스를 주면
   * 아직 없는 입력칸을 가리켜 커서가 안 잡힌다. 셋이 다 갖춰진 순간을 기다린다.
   */
  const ready = !!draft && !!set && !!settings;
  useEffect(() => {
    if (!ready) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [ready, draft?.id]);

  /* Esc 로 닫는다. 팝업이 떠 있는 동안 뒤 화면의 단축키가 먹지 않게 여기서 멈춘다. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const suggestions = useMemo(
    () => (draft && settings && set ? suggestFor(draft, siblings, set.domain, settings.chosungMap) : []),
    [draft, siblings, settings, set],
  );

  if (!draft || !set || !settings) return null;

  const save = async (next?: MemoImage) => {
    const d = next ?? draft;
    await db.images.put({ ...d, updatedAt: Date.now() });
  };
  const pick = async (name: string) => {
    const next = { ...draft, name };
    setDraft(next);
    await save(next);
    nameRef.current?.focus();
  };
  const close = async () => { await save(); onClose(); };
  const label = set.domain === 'cardFace' ? cardLabel(draft.key) : draft.key;

  /*
   * 대화상자 = 책상 위에 놓인 서류철 한 권. 옛 튀어나오는 연출(mg-pop) 대신 화면 넘김과 같은 떠오름(lp-page-in).
   * 바깥(책상)을 누르면 저장하고 닫는다. 폭은 앱 기둥에 맞춘다.
   */
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-desk/75 p-3.5 pt-8 sm:items-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 편집`}
    >
      <div className="lp-page-in w-full max-w-[calc(var(--col-w)_-_28px)]" onClick={(e) => e.stopPropagation()}>
        <Folder tab={`${label} 편집`}>
          <ImageFields
            draft={draft}
            onDraft={setDraft}
            onSave={() => save()}
            domain={set.domain}
            map={settings.chosungMap}
            suggestions={suggestions}
            onPick={pick}
            apiKey={settings.aiKey}
            used={siblings.filter((i) => i.id !== draft.id && i.name.trim()).map((i) => i.name)}
            nameRef={nameRef}
            onNameKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(); } }}
          />
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto font-typek text-[11px] text-ink-2">Enter 저장 · Esc 닫기</span>
            <Key onClick={close}>저장하고 닫기</Key>
          </div>
        </Folder>
      </div>
    </div>
  );
}
