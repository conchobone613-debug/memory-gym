import { useEffect, useState, type RefObject } from 'react';
import type { MemoImage, SetDomain } from '../db/db';
import { hintForKey, type ChosungMap } from '../lib/hangul';
import { faceHint } from '../lib/cards';
import type { Suggestion } from '../lib/suggest';
import { Field } from './ui';

/**
 * 이미지 한 칸을 고치는 입력 묶음.
 *
 * 세트 편집기와 드릴 결과 화면의 팝업이 **같은 상자**를 쓴다. 별칭은 채점에 그대로 쓰이므로
 * 두 곳의 입력이 갈라지면 한쪽에서 고친 것이 다른 쪽 채점과 어긋난다.
 *
 * 화면 상태(draft)와 저장은 부르는 쪽이 들고 있는다 — 편집기는 Enter 로 다음 칸까지 가고
 * 팝업은 그 자리에서 끝나기 때문에, 그 차이를 이 안에 넣으면 분기가 생긴다.
 */
export default function ImageFields({
  draft, onDraft, onSave, domain, map, suggestions, onPick, nameRef, onNameKey,
}: {
  draft: MemoImage;
  onDraft: (next: MemoImage) => void;
  onSave: () => void;
  domain: SetDomain;
  map: ChosungMap;
  suggestions: Suggestion[];
  /** 후보를 눌렀을 때. 넣고 바로 저장하는 쪽이 자연스러워 부르는 쪽에 맡긴다. */
  onPick: (name: string) => void;
  nameRef?: RefObject<HTMLInputElement | null>;
  onNameKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

  /*
   * 후보는 5개씩만 보여 준다. 한 번에 다 깔면 고르는 일이 되고, 짧은 이름이 앞에 오도록
   * 정렬돼 있으니 뒤로 갈수록 덜 좋은 것이 나온다. 마음에 안 드시면 '다른 후보' 로 넘긴다.
   */
  const PER_PAGE = 5;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [draft.key]);
  const pages = Math.max(1, Math.ceil(suggestions.length / PER_PAGE));
  const shown = suggestions.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="이미지 이름"
          hint={
            domain === 'cardFace'
              ? (faceHint(draft.key) ?? '인물 카드 — 초성 규칙 없음')
              : `초성 힌트 ${hintForKey(draft.key, map)}`
          }
        >
          <input
            ref={nameRef}
            value={draft.name}
            onChange={(e) => onDraft({ ...draft, name: e.target.value })}
            onBlur={onSave}
            onKeyDown={onNameKey}
            placeholder="예: 기차"
          />
        </Field>
        <Field label="별칭 (쉼표로 구분 — 채점 시 인정)">
          <input
            value={draft.aliases.join(', ')}
            onChange={(e) => onDraft({ ...draft, aliases: list(e.target.value) })}
            onBlur={onSave}
            placeholder="열차, 증기기관차"
          />
        </Field>
        <Field label="세부 묘사 (혼동 방지)">
          <input
            value={draft.note}
            onChange={(e) => onDraft({ ...draft, note: e.target.value })}
            onBlur={onSave}
            placeholder="검은 연기를 뿜는 증기기관차"
          />
        </Field>
        <Field label="태그 (쉼표로 구분)">
          <input
            value={draft.tags.join(', ')}
            onChange={(e) => onDraft({ ...draft, tags: list(e.target.value) })}
            onBlur={onSave}
            placeholder="동물, 탈것"
          />
        </Field>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-muted">이름 후보</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {shown.map((sg) => (
              <button
                key={sg.name}
                type="button"
                onClick={() => onPick(sg.name)}
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
            {pages > 1 && (
              <button
                type="button"
                onClick={() => setPage((p) => (p + 1) % pages)}
                className="rounded-md border border-line/70 px-2.5 py-1 text-sm text-muted transition-colors hover:border-accent hover:text-accent"
              >
                다른 후보 ↻
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
