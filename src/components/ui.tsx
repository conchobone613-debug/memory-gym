import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { sfx } from '../design/sfx';

/*
 * 앱 공통 기본 틀 — 1950년대 계산실 디자인(components/lp)의 모양을 따른다.
 * 새 화면은 가능한 한 components/lp 의 부품(Folder · IndexCard · Key · Dymo …)을 직접 쓰고,
 * 이 파일은 설정·표처럼 부품이 따로 없는 곳의 종이 상자·자판 버튼을 맡는다.
 */

/** 종이 한 장 상자. 제목은 간판 글씨. 목록은 IndexCard, 할 일 한 덩어리는 Folder 를 먼저 생각할 것. */
export function Panel({ title, right, children, className = '' }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`lp-panel ${className}`}>
      {(title || right) && (
        <header className="lp-panel-head">
          <h2 className="lp-panel-title">{title}</h2>
          {right}
        </header>
      )}
      <div className="lp-panel-body">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'ghost' | 'danger' | 'good';
type Size = 'sm' | 'md' | 'lg';

/* 빨간 자판은 화면의 주 동작 하나(Key tone="red")만 — 여기 변형은 남색·크림색으로 둔다. */
const VARIANT: Record<Variant, string> = {
  primary: '',
  good: '',
  ghost: 'is-cream',
  danger: 'is-cream is-danger',
};
const SIZE: Record<Size, string> = { sm: 'is-sm', md: '', lg: 'is-lg' };

const btnClass = (variant: Variant, size: Size, extra: string) => `lp-key ${VARIANT[variant]} ${SIZE[size]} ${extra}`;

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Btn({ variant = 'ghost', size = 'md', className = '', onPointerDown, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={btnClass(variant, size, className)}
      onPointerDown={(e) => { if (!rest.disabled) sfx.key(size === 'lg'); onPointerDown?.(e); }}
    />
  );
}

/** 링크는 Link 자체를 버튼처럼 칠한다. <Link><button/></Link> 은 잘못된 HTML 이라 클릭이 먹지 않는다. */
export function LinkBtn({ to, variant = 'ghost', size = 'md', className = '', children }: {
  to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode;
}) {
  return <Link to={to} className={btnClass(variant, size, className)} onPointerDown={() => sfx.key(size === 'lg')}>{children}</Link>;
}

/**
 * 되돌릴 수 없는 동작은 이 버튼으로 받는다.
 * window.confirm 을 쓰지 않는 이유: 브라우저·웹뷰에 따라 대화상자가 막히면 조용히 false 가
 * 돌아와 삭제가 아무 일도 없이 취소된다(실제로 겪음). 확인은 앱 안에서 받아야 한다.
 */
export function ConfirmBtn({ label, confirmLabel, onConfirm, size = 'md' }: {
  label: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  size?: Size;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return <Btn variant="danger" size={size} onClick={() => setArmed(true)}>{label}</Btn>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-[4px] border border-dashed border-red bg-near px-2 py-1.5">
      <span className="font-typek text-xs text-red">{confirmLabel}</span>
      <Btn variant="danger" size="sm" onClick={() => { setArmed(false); onConfirm(); }}>지웁니다</Btn>
      <Btn size="sm" onClick={() => setArmed(false)}>취소</Btn>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-typek text-[11px] font-bold tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="font-typek text-[11px] text-ink-2">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center font-typek text-[13px] text-ink-2">{children}</p>;
}

/** 작은 기록 칸 — 종이 쪽지 위 타자기 숫자 */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="lp-stat">
      <div className="lp-stat-label">{label}</div>
      <div className="lp-stat-value tnum">{value}</div>
      {sub && <div className="lp-stat-sub">{sub}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** 숫자는 단위를 붙여 짧게: 1.57초, 96% */
export const fmtMs = (x: number) => (x ? `${(x / 1000).toFixed(2)}초` : '—');
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * 연속 정답(측정 화면이 아닌 곳의 작은 표시). 측정 화면은 components/lp 의 계수기(ComboCounter)를 쓴다.
 * 이모지는 쓰지 않는다(디자인 시스템 「글」).
 */
export function Streak({ n }: { n: number }) {
  if (n < 2) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-[3px] bg-ink px-2 py-0.5 font-typek text-xs text-paper">
      <span className="tnum font-bold">{n}</span>
      연속
    </span>
  );
}
