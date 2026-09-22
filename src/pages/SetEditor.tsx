import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { compareKeys, db, ensureKeys, getSettings, type MemoImage } from '../db/db';
import { hintForKey } from '../lib/hangul';
import { suggestNames, FACE_SUGGESTIONS } from '../lib/suggest';
import { cardLabel, faceHint } from '../lib/cards';
import { download, importRows, pickFile, rowsFromCsv, setFileBase, toCsv } from '../lib/io';
import { isTyping } from '../App';
import { Btn, Empty, Field, LinkBtn, Panel } from '../components/ui';

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

  const current = images[cursor];
  /*
   * 한 줄에 '00 오이' 를 담으려면 칸이 90px 은 돼야 한다. 창이 좁으면 10칸을 고집하지 않고
   * 5칸으로 접는다 — 십의 자리 줄맞춤보다 이름이 읽히는 쪽이 먼저다.
   */
  const cols = set?.domain === 'cardFace' ? 3 : set?.domain === 'custom' ? 5 : 10;
  const gridCls =
    set?.domain === 'cardFace' ? 'grid-cols-3'
      : set?.domain === 'custom' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
        : 'grid-cols-5 xl:grid-cols-10';

  useEffect(() => {
    setDraft(current ? { ...current } : null);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setCursor(to);
    requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
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
  const suggestions = useMemo(() => {
    if (!draft || !settings) return [];
    const used = images.filter((i) => i.id !== draft.id && i.name.trim()).map((i) => i.name);
    if (set?.domain === 'cardFace') {
      const taken = new Set(used.map((n) => n.replace(/\s+/g, '')));
      return FACE_SUGGESTIONS.map((name) => ({ name, taken: taken.has(name) }));
    }
    return suggestNames(draft.key, settings.chosungMap, used);
  }, [draft?.key, draft?.id, images, settings, set?.domain]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Link to="/assets/sets" className="text-accent">
          목록으로
        </Link>
      </Empty>
    );
  }

  const label = (key: string) => (set.domain === 'cardFace' ? cardLabel(key) : key);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={`${set.name} — ${filled}/${images.length} 채움`}
        right={
          <div className="flex gap-1.5">
            <Btn size="sm" onClick={doImport}>가져오기</Btn>
            <Btn size="sm" onClick={doExportCsv}>CSV</Btn>
            <Btn size="sm" onClick={doExportJson}>JSON</Btn>
            {set.keyGenerator && (
              <Btn size="sm" onClick={async () => setMsg(`빈 키 ${await ensureKeys(set)}개 생성`)}>
                키 채우기
              </Btn>
            )}
            <LinkBtn to="/assets/sets" size="sm">목록</LinkBtn>
          </div>
        }
      >
        {images.length === 0 ? (
          <Empty>이 세트에는 키가 없습니다. '키 채우기'를 누르시거나 CSV 로 가져오십시오.</Empty>
        ) : (
          <div className={`grid gap-1 ${gridCls}`}>
            {images.map((img, i) => {
              const on = i === cursor;
              return (
                <button
                  key={img.id}
                  onClick={() => setCursor(i)}
                  onDoubleClick={() => nameRef.current?.focus()}
                  title={img.name || undefined}
                  /* 키와 이름을 한 줄에 둔다. 두 줄로 쌓으면 칸의 절반이 빈 공간이 된다. */
                  className={`flex w-full items-baseline gap-1.5 rounded-md border px-2 py-2 text-left transition-colors ${
                    on
                      ? 'border-accent bg-accent/15'
                      : img.name
                        ? 'border-line bg-panel2'
                        : 'border-line/60 bg-transparent'
                  }`}
                >
                  <span className="tnum shrink-0 text-xs text-accent/70">{label(img.key)}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${img.name ? '' : 'text-muted/40'}`}>
                    {img.name || '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {draft && settings && (
        <Panel
          title={`${label(draft.key)} 편집`}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="이미지 이름"
              hint={
                set.domain === 'cardFace'
                  ? (faceHint(draft.key) ?? '인물 카드 — 초성 규칙 없음')
                  : `초성 힌트 ${hintForKey(draft.key, settings.chosungMap)}`
              }
            >
              <input
                ref={nameRef}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onBlur={() => save()}
                onKeyDown={onNameKey}
                placeholder="예: 기차"
              />
            </Field>
            <Field label="별칭 (쉼표로 구분 — 채점 시 인정)">
              <input
                value={draft.aliases.join(', ')}
                onChange={(e) =>
                  setDraft({ ...draft, aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
                onBlur={() => save()}
                placeholder="열차, 증기기관차"
              />
            </Field>
            <Field label="세부 묘사 (혼동 방지)">
              <input
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                onBlur={() => save()}
                placeholder="검은 연기를 뿜는 증기기관차"
              />
            </Field>
            <Field label="태그 (쉼표로 구분)">
              <input
                value={draft.tags.join(', ')}
                onChange={(e) =>
                  setDraft({ ...draft, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
                onBlur={() => save()}
                placeholder="동물, 탈것"
              />
            </Field>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-muted">
이름 후보
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((sg) => (
                  <button
                    key={sg.name}
                    type="button"
                    onClick={() => useSuggestion(sg.name)}
                    title={sg.taken ? '다른 칸에서 이미 쓰고 있습니다' : undefined}
                    className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                      sg.taken
                        ? 'border-line/60 text-muted/50 line-through'
                        : 'border-line bg-panel2 hover:border-accent hover:text-accent'
                    }`}
                  >
                    {sg.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-1.5">
            <Btn size="sm" variant="primary" onClick={() => save()}>저장</Btn>
            <Btn size="sm" onClick={() => setCursor(nextEmpty(cursor))}>다음 빈 칸</Btn>
            {draft.name && (
              <Btn
                size="sm"
                variant="danger"
                onClick={async () => {
                  const cleared = { ...draft, name: '', aliases: [], note: '' };
                  setDraft(cleared);
                  await save(cleared);
                }}
              >
                내용 지우기
              </Btn>
            )}
          </div>
        </Panel>
      )}

      {msg && <p className="text-xs text-accent">{msg}</p>}
    </div>
  );
}
