import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { sfx } from '../../design/sfx';
import { reduced } from '../../design/settings';

/* 디자인 시스템 부품의 React 판. 모양은 design/lampadas.css 의 lp- 클래스, 설명은 디자인 시스템 components/<이름>/README.md. */

/** public/art 의 그림·영상 주소. 배포 주소 아래(/memory-gym/)에 붙는다. */
export const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}`;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ── Key: 타자기 자판 버튼 ─────────────────────────── */

export type KeyTone = 'ink' | 'red' | 'cream';
export type KeySize = 'md' | 'sm' | 'big' | 'round';

function keyClass(tone: KeyTone, size: KeySize, extra?: string) {
  return cx('lp-key', tone === 'red' && 'is-red', tone === 'cream' && 'is-cream',
    size === 'big' && 'is-big', size === 'round' && 'is-round', size === 'sm' && 'is-sm', extra);
}

type KeyProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: KeyTone;
  size?: KeySize;
  /** 아래 줄 작은 글자(단축키·부연). 예: 'Enter', '15분 · 3가지' */
  sub?: ReactNode;
};

/**
 * 누르면 4px 쑥 들어가고 타자기 소리가 난다. 빨간 자판은 화면에 하나만(주 동작).
 * 측정 화면의 답 입력에는 쓰지 않는다 — 입력은 키보드·키패드가 받는다.
 */
export function Key({ tone = 'ink', size = 'md', sub, className, children, onPointerDown, ...rest }: KeyProps) {
  return (
    <button
      type="button"
      {...rest}
      className={keyClass(tone, size, className)}
      onPointerDown={(e) => { if (!rest.disabled) sfx.key(size === 'big'); onPointerDown?.(e); }}
    >
      {children}
      {sub && <small>{sub}</small>}
    </button>
  );
}

/** 링크를 자판처럼. <Link><button/></Link> 은 잘못된 HTML 이라 클릭이 먹지 않는다. */
export function KeyLink({ to, tone = 'ink', size = 'md', sub, className, children }: {
  to: string; tone?: KeyTone; size?: KeySize; sub?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <Link to={to} className={keyClass(tone, size, className)} onPointerDown={() => sfx.key(size === 'big')}>
      {children}
      {sub && <small>{sub}</small>}
    </Link>
  );
}

/** 키보드 단축키로 버튼을 부를 때: 그 버튼에도 눌림이 보이고 같은 소리가 난다(손과 화면이 이어진다). */
export function pressVisual(el: HTMLElement | null, heavy = false) {
  sfx.key(heavy);
  if (!el || reduced()) return;
  el.classList.add('is-down');
  window.setTimeout(() => el.classList.remove('is-down'), 90);
}

/* ── Dymo: 다이모 라벨 중간 제목 ─────────────────────── */

/** 구역 이름표. 두세 낱말. 색은 영역 구분에만 — 기억력 = red, 계산 = blue. 한 화면에 셋까지. */
export function Dymo({ tone, small, children, className }: { tone?: 'red' | 'blue'; small?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx('lp-dymo', tone === 'red' && 'is-red', tone === 'blue' && 'is-blue', small && 'is-sm', className)}>{children}</span>;
}

/* ── Folder: 서류철 상자 ──────────────────────────── */

/** 한 덩어리의 할 일(스승님 쪽지, 설정 묶음, 오늘의 코스). 탭 이름은 두 낱말 이내. 서류철 안에 서류철 금지. */
export function Folder({ tab, clip, children, className, id }: { tab: string; clip?: boolean; children: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cx('lp-folder', className)} data-tab={tab} id={id}>
      {clip && <svg className="lp-clip" aria-hidden><use href="#lp-clip" /></svg>}
      {children}
    </div>
  );
}

/* ── IndexCard: 도서관 목록 카드 ─────────────────────── */

/**
 * 종목·항목 목록의 한 줄. 잠긴 항목은 locked + body 에 무엇이 있어야 열리는지.
 * 스크롤로 화면에 들어올 때 한 번만 아래에서 올라온다(처음부터 보이던 카드는 움직이지 않는다).
 */
export function IndexCard({ title, meta, body, locked, to, onClick, children, className }: {
  title: ReactNode; meta?: ReactNode; body?: ReactNode; locked?: boolean; to?: string;
  onClick?: () => void; children?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let first = true;
    const io = new IntersectionObserver(([e]) => {
      if (first) {
        first = false;
        if (e.isIntersecting) io.disconnect();
        return;
      }
      if (e.isIntersecting) {
        if (!reduced()) el.classList.add('is-in');
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const inner = (
    <>
      <div className="lp-index-head">
        <span className="lp-index-title">{title}</span>
        {meta != null && <span className="lp-index-meta">{meta}</span>}
      </div>
      {body != null && <span className="lp-index-body">{body}</span>}
      {children}
      {locked && <span className="lp-index-lock">잠김</span>}
    </>
  );
  const cls = cx('lp-index', locked && 'is-locked', className);
  if (to) return <Link ref={(n) => { ref.current = n; }} to={to} className={cls}>{inner}</Link>;
  if (onClick) return <button ref={(n) => { ref.current = n; }} type="button" onClick={onClick} className={cx(cls, 'w-full text-left')}>{inner}</button>;
  return <div ref={(n) => { ref.current = n; }} className={cls}>{inner}</div>;
}

/* ── TearCalendar · Gauge: 연속일과 오늘 채운 시간 ─────── */

export function TearCalendar({ head, num, unit }: { head: string; num: ReactNode; unit: string }) {
  return (
    <div className="lp-cal">
      <div className="lp-cal-head">{head}</div>
      <b className="lp-cal-num">{num}</b>
      <span className="lp-cal-unit">{unit}</span>
    </div>
  );
}

/** p = 0~1. 아래 줄에 남은 양을 평문으로. */
export function Gauge({ top, p, bottom }: { top: ReactNode; p: number; bottom?: ReactNode }) {
  return (
    <div className="lp-gauge">
      <span>{top}</span>
      <div className="lp-gauge-track"><div className="lp-gauge-fill" style={{ '--p': Math.max(0, Math.min(1, p)) } as CSSProperties} /></div>
      <div className="lp-gauge-ticks" />
      {bottom && <span>{bottom}</span>}
    </div>
  );
}

/* ── TvFrame: 브라운관 텔레비전 ───────────────────────── */

/** 모든 사진은 텔레비전 안에 넣는다. 주사선·색 번짐은 코드가 입힌다(그림에 굽지 않는다). */
export function TvImage({ src, alt, aspect = '4 / 3', bw, className, imgStyle }: {
  src: string; alt: string; aspect?: string; bw?: boolean; className?: string; imgStyle?: CSSProperties;
}) {
  return (
    <div className={cx('lp-tv', className)}>
      <div className={cx('lp-crt', bw && 'is-bw')} style={{ aspectRatio: aspect }}>
        <img src={src} alt={alt} style={imgStyle} />
      </div>
    </div>
  );
}

/**
 * 반복 영상 — 앱에서 끝없이 도는 것은 이것 하나뿐이라 조건을 둔다.
 * 화면에 보일 때만 불러와 재생하고, 탭이 숨거나 움직임 줄이기면 멈추고 정지 그림(poster)만 남긴다.
 */
export function TvVideo({ poster, webm, mp4, alt, aspect = '4 / 3', className }: {
  poster: string; webm?: string; mp4?: string; alt: string; aspect?: string; className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let visible = false;
    let loaded = false;
    const sync = () => {
      if (visible && !document.hidden && !reduced()) {
        if (!loaded) {
          v.querySelectorAll('source').forEach((s) => { s.src = s.dataset.src ?? ''; });
          v.load();
          loaded = true;
        }
        v.play().catch(() => {});
      } else v.pause();
    };
    const io = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.2 });
    io?.observe(v);
    document.addEventListener('visibilitychange', sync);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    mq?.addEventListener?.('change', sync);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      mq?.removeEventListener?.('change', sync);
      v.pause();
    };
  }, []);
  return (
    <div className={cx('lp-tv', className)}>
      <div className="lp-crt" style={{ aspectRatio: aspect }}>
        <video ref={ref} muted playsInline loop preload="none" poster={poster} aria-label={alt}>
          {webm && <source data-src={webm} type="video/webm" />}
          {mp4 && <source data-src={mp4} type="video/mp4" />}
        </video>
      </div>
    </div>
  );
}

/* ── SageNote: 스승님 쪽지 ─────────────────────────── */

/**
 * 스승님이 **직접 하는 말**에만 쓴다(노교수 하게체 — "…해 보세", "…하게"). 숫자는 코드가 계산한 실제 값만.
 * 제목·버튼·안내는 스승님 말투로 쓰지 않는다(평문). 한 화면에 쪽지 하나.
 */
export function SageNote({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <div className={cx('lp-sage', small && 'is-s')}>
      <div className="lp-tv"><div className="lp-crt"><img src={art('sage.webp')} alt="스승님" /></div></div>
      <p className={cx('lp-note', small && 'is-s')}>{children}</p>
    </div>
  );
}

/* ── Stamp · Star ─────────────────────────────────── */

export function Stamp({ children = '합격', tone }: { children?: ReactNode; tone?: 'blue' }) {
  return <span className={cx('lp-stamp', tone === 'blue' && 'is-blue')}>{children}</span>;
}

export function Star({ off, className }: { off?: boolean; className?: string }) {
  return <svg className={cx('lp-star', off && 'is-off', className)} viewBox="0 0 48 48" aria-hidden><use href="#lp-star" /></svg>;
}
