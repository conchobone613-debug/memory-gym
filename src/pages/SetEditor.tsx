import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { compareKeys, db, ensureKeys, getSettings, type MemoImage } from '../db/db';
import { suggestFor } from '../lib/suggest';
import { cardLabel } from '../lib/cards';
import { download, importRows, pickFile, rowsFromCsv, setFileBase, toCsv } from '../lib/io';
import { isTyping } from '../App';
import { Empty } from '../components/ui';
import { Dymo, Folder, Key, KeyLink } from '../components/lp';
import ImageFields from '../components/ImageFields';

export default function SetEditor() {
  const { setId = '' } = useParams();
  const set = useLiveQuery(() => db.imageSets.get(setId), [setId]);
  const images = useLiveQuery(
    async () => {
      const set = await db.imageSets.get(setId);
      const rows = await db.images.where('setId').equals(setId).toArray();
      return rows.sort((a, b) => compareKeys(set?.domain ?? 'custom', a.key, b.key));
    },
    [setId],
    [] as MemoImage[],
  );
  const settings = useLiveQuery(() => getSettings(), []);
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<MemoImage | null>(null);
  const [msg, setMsg] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  /** Enter 로 옮겨 간 칸. 그 칸의 이름이 입력칸에 그려진 뒤 골라 둔다(아래 effect). */
  const selectFor = useRef<string | null>(null);

  const current = images[cursor];
  /*
   * 앱은 휴대폰 폭 기둥 하나라 창 폭에 따라 칸 수를 바꾸지 않는다. 방향키 위아래 이동 폭이 곧 칸 수라
   * 화면과 어긋나지 않는다. 숫자는 10칸 — 십의 자리가 한 줄에 맞는다. 칸이 좁아(휴대폰 약 33px)
   * 키 위·이름 아래 두 줄로 쌓고 이름 글자를 줄였다. 세 글자 이름까지 보이고 긴 이름은 아래 편집 칸에서 본다.
   */
  const cols = set?.domain === 'cardFace' || set?.domain === 'custom' ? 3 : 10;
  const dense = cols === 10;

  useEffect(() => {
    setDraft(current ? { ...current } : null);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * 포커스에 requestAnimationFrame 을 쓰지 않는다 — 창이 그리지 않는 동안 콜백이 오지 않아 커서가 안 잡힌다.
   * 새 칸의 draft 가 입력칸에 들어간 뒤 여기서 바로 고른다.
   */
  const draftId = draft?.id;
  useEffect(() => {
    if (!draftId || selectFor.current !== draftId) return;
    selectFor.current = null;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [draftId]);

  const save = async (next?: MemoImage) => {
    const d = next ?? draft;
    if (!d) return;
    await db.images.put({ ...d, updatedAt: Date.now() });
  };

  const nextEmpty = (from: number) => {
    for (let i = from + 1; i < images.length; i++) if (!images[i].name.trim()) return i;
    for (let i = 0; i <= from; i++) if (!images[i].name.trim()) return i;
    return from;
  };

  /* 그리드 키보드 이동 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
      if (e.key in map) {
        e.preventDefault();
        setCursor((c) => Math.min(images.length - 1, Math.max(0, c + map[e.key])));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        nameRef.current?.focus();
        nameRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cols, images.length]);

  const onNameKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    await save();
    const to = e.shiftKey ? nextEmpty(cursor) : Math.min(images.length - 1, cursor + 1);
    /* 같은 칸에 머물면 draft 가 바뀌지 않아 effect 가 오지 않는다 — 입력칸은 그대로라 바로 고른다. */
    if (to === cursor) {
      nameRef.current?.select();
      return;
    }
    selectFor.current = images[to].id;
    setCursor(to);
  };

  const doExportCsv = () => set && download(`${setFileBase(set)}.csv`, toCsv(images), 'text/csv;charset=utf-8');
  const doExportJson = () =>
    set && download(`${setFileBase(set)}.json`, JSON.stringify({ set: set.name, images }, null, 2), 'application/json');

  const doImport = async () => {
    const text = await pickFile('.csv,.json,text/csv,application/json');
    if (!text) return;
    try {
      const trimmed = text.trim();
      let rows;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        const arr: MemoImage[] = Array.isArray(parsed) ? parsed : parsed.images;
        rows = arr.map((i) => ({
          key: String(i.key),
          name: i.name ?? '',
          aliases: i.aliases ?? [],
          note: i.note ?? '',
          tags: i.tags ?? [],
        }));
      } else {
        rows = rowsFromCsv(text);
      }
      const r = await importRows(setId, rows);
      setMsg(`가져오기 완료 — 수정 ${r.updated}개, 추가 ${r.created}개`);
    } catch (err) {
      setMsg(`가져오기 실패: ${(err as Error).message}`);
    }
  };

  const filled = useMemo(() => images.filter((i) => i.name.trim()).length, [images]);

  /* 빈 칸에서 막히실 때 쓰실 후보. 이미 쓰고 있는 이름은 표시해 둔다. */
  const suggestions = useMemo(
    () => (draft && settings && set ? suggestFor(draft, images, set.domain, settings.chosungMap) : []),
    [draft, images, settings, set],
  );

  const useSuggestion = async (name: string) => {
    if (!draft) return;
    const next = { ...draft, name };
    setDraft(next);
    await save(next);
    nameRef.current?.focus();
  };

  if (!set) {
    return (
      <Empty>
        세트를 찾을 수 없습니다.{' '}
        <Link to="/assets/sets" className="text-ink underline">
          목록으로
        </Link>
      </Empty>
    );
  }

  const label = (key: string) => (set.domain === 'cardFace' ? cardLabel(key) : key);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 truncate font-sign text-[32px] leading-[1.1] text-ink">{set.name}</h1>
          <p className="m-0 mt-1 font-typek text-[12px] font-bold text-ink-2">
            채운 이미지 <span className="tnum text-ink">{filled}/{images.length}</span>
          </p>
        </div>
        <KeyLink to="/assets/sets" tone="cream" size="sm" className="mt-1 shrink-0">목록</KeyLink>
      </header>

      {images.length === 0 ? (
        <Empty>이 세트에는 키가 없습니다. '키 채우기'를 누르시거나 CSV 로 가져오십시오.</Empty>
      ) : (
        <div>
          {/* 칸은 종이 카드. 채운 칸 = 판판한 카드 + 이름, 빈 칸 = 점선 테두리 + '—' (색에만 기대지 않는다). */}
          <div className={`grid gap-[2px] ${cols === 10 ? 'grid-cols-10' : 'grid-cols-3'}`}>
            {images.map((img, i) => {
              const on = i === cursor;
              const has = !!img.name;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setCursor(i)}
                  onDoubleClick={() => nameRef.current?.focus()}
                  title={img.name || undefined}
                  aria-pressed={on}
                  className={`flex min-w-0 flex-col items-center gap-[3px] rounded-[3px] border px-0 ${dense ? 'py-[5px]' : 'py-2'} ${
                    has ? 'border-card-edge bg-card shadow-[var(--paper-lift)]' : 'border-dashed border-ink-2/40'
                  } ${on ? 'outline-2 outline-offset-1 outline-ink' : ''}`}
                >
                  <span className={`tnum font-bold leading-none ${dense ? 'text-[11px]' : 'text-[14px]'} ${has ? 'text-ink' : 'text-ink-2'}`}>
                    {label(img.key)}
                  </span>
                  <span
                    className={`w-full truncate text-center font-typek leading-[1.15] ${
                      dense ? 'text-[10px] tracking-[-.04em]' : 'px-1.5 text-[13px]'
                    } ${has ? 'text-ink' : 'text-ink-2/60'}`}
                  >
                    {img.name || '—'}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="m-0 mt-2.5 font-typek text-[11px] leading-[1.5] text-ink-2">
            방향키 이동 · Enter 이름 쓰기 · 이름 칸에서 Enter 다음 칸, Shift+Enter 다음 빈 칸
          </p>
        </div>
      )}

      {draft && settings && (
        <Folder tab={`${label(draft.key)} 편집`} clip>
          <ImageFields
            draft={draft}
            onDraft={setDraft}
            onSave={() => save()}
            domain={set.domain}
            map={settings.chosungMap}
            suggestions={suggestions}
            onPick={useSuggestion}
            apiKey={settings.aiKey}
            used={images.filter((i) => i.id !== draft.id && i.name.trim()).map((i) => i.name)}
            nameRef={nameRef}
            onNameKey={onNameKey}
          />

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Key tone="red" size="sm" onClick={() => save()}>저장</Key>
            <Key tone="cream" size="sm" onClick={() => setCursor(nextEmpty(cursor))}>다음 빈 칸</Key>
            {draft.name && (
              <Key
                tone="cream"
                size="sm"
                className="is-danger"
                onClick={async () => {
                  const cleared = { ...draft, name: '', aliases: [], note: '' };
                  setDraft(cleared);
                  await save(cleared);
                }}
              >
                내용 지우기
              </Key>
            )}
          </div>
        </Folder>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <span><Dymo small>파일</Dymo></span>
        <div className="flex flex-wrap gap-2.5">
          <Key tone="cream" size="sm" onClick={doImport}>가져오기</Key>
          <Key tone="cream" size="sm" onClick={doExportCsv}>CSV 내보내기</Key>
          <Key tone="cream" size="sm" onClick={doExportJson}>JSON 내보내기</Key>
          {set.keyGenerator && (
            <Key tone="cream" size="sm" onClick={async () => setMsg(`빈 키 ${await ensureKeys(set)}개 생성`)}>
              키 채우기
            </Key>
          )}
        </div>
        {msg && <p role="status" className="m-0 font-typek text-[12px] text-ink">{msg}</p>}
      </div>
    </div>
  );
}
