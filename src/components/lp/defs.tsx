/**
 * 문서에 한 번만 넣는 SVG 조각 — 브라운관 색 번짐(#lp-rgb), 도장 잉크 질감(#lp-rough),
 * 금별(#lp-star), 서류철 클립(#lp-clip). App 이 맨 위에 한 번 그린다.
 */
export default function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="lp-rough">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3" />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.55" />
        <feComposite in="SourceGraphic" operator="in" />
      </filter>
      <filter id="lp-rgb" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
        <feOffset in="r" dx="1.2" result="r2" />
        <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
        <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
        <feOffset in="b" dx="-1.2" result="b2" />
        <feBlend in="r2" in2="g" mode="screen" result="rg" />
        <feBlend in="rg" in2="b2" mode="screen" />
      </filter>
      <symbol id="lp-star" viewBox="0 0 48 48">
        <defs>
          <linearGradient id="lp-foil" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff2b8" />
            <stop offset=".45" stopColor="#e2b64c" />
            <stop offset=".55" stopColor="#b98a2e" />
            <stop offset="1" stopColor="#f3d77c" />
          </linearGradient>
        </defs>
        <path d="M24 3l6.2 13.4 14.6 1.6-10.9 9.9 3 14.4L24 35 11.1 42.3l3-14.4L3.2 18l14.6-1.6z" fill="url(#lp-foil)" stroke="#9c7426" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M24 9l2 6" stroke="#fff8" strokeWidth="2" strokeLinecap="round" />
      </symbol>
      <symbol id="lp-clip" viewBox="0 0 18 44">
        <path d="M5 40V9a4 4 0 0 1 8 0v26a2.5 2.5 0 0 1-5 0V12" fill="none" stroke="#8d9097" strokeWidth="2.2" strokeLinecap="round" />
      </symbol>
    </svg>
  );
}
