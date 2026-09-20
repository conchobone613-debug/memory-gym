import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Panel({ title, right, children, className = '' }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-muted">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'ghost' | 'danger' | 'good';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-ink hover:brightness-110 border-transparent font-semibold',
  good: 'bg-good text-ink hover:brightness-110 border-transparent font-semibold',
  danger: 'bg-transparent text-bad border-bad/50 hover:bg-bad/10',
  ghost: 'bg-panel2 border-line hover:border-accent/60',
};
const SIZE: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-5 py-3 text-base',
};

const btnClass = (variant: Variant, size: Size, extra: string) =>
  `inline-block rounded-lg border text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${extra}`;

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Btn({ variant = 'ghost', size = 'md', className = '', ...rest }: BtnProps) {
  return <button {...rest} className={btnClass(variant, size, className)} />;
}

/** 링크는 Link 자체를 버튼처럼 칠한다. <Link><button/></Link> 은 잘못된 HTML 이라 클릭이 먹지 않는다. */
export function LinkBtn({ to, variant = 'ghost', size = 'md', className = '', children }: {
  to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode;
}) {
  return <Link to={to} className={btnClass(variant, size, className)}>{children}</Link>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted">{children}</p>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tnum text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export const fmtMs = (x: number) => (x ? `${(x / 1000).toFixed(2)}s` : '—');
export const fmtPct = (x: number) => `${Math.round(x * 100)}%`;
