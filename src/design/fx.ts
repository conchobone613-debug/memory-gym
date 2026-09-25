import { reduced } from './settings';
import { sfx } from './sfx';

/*
 * 연출 — 입력을 막지 않는 연출 층(.lp-fx)에서만 돈다.
 * 디자인 시스템 bundle.js 의 BrainGym.fx 를 옮긴 것.
 * 측정 구간(문제가 뜬 순간부터 답을 치는 동안)의 문제 카드(.lp-question)에는 어떤 연출도 걸지 않는다.
 */

function anim(el: Element | null, frames: Keyframe[], opt: KeyframeAnimationOptions): Animation | null {
  return el && 'animate' in el ? el.animate(frames, opt) : null;
}

export const fx = {
  /** 가장자리 빛 한 번. el = .lp-edge 요소 */
  flash(el: HTMLElement | null, peak = 1, durationMs = 240) {
    anim(el, [{ opacity: 0 }, { opacity: peak, offset: 0.3 }, { opacity: 0 }], {
      duration: reduced() ? 400 : durationMs,
      easing: 'ease-out',
    });
  },

  /**
   * 조각 튀기기. host = 연출 층, (x,y) = host 기준 출발점, kind = 'chad'(천공 카드 조각) | 'tape'(색종이 테이프).
   * floor 를 주면 위쪽 반원으로만 튀고 그 y 아래로는 내려가지 않는다 — 측정 화면에서 문제 카드 윗선을 넘기면 안 된다.
   */
  spray(host: HTMLElement | null, x: number, y: number, count: number, kind: 'chad' | 'tape', spread = 1, floor?: number) {
    if (reduced() || !host) return;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'lp-bit';
      if (kind === 'chad') {
        const w = 5 + Math.random() * 4;
        s.style.cssText = `width:${w * 1.6}px;height:${w}px;border-radius:2px;background:${Math.random() < 0.7 ? '#efe2c2' : '#e8c46a'};box-shadow:0 0 0 .5px #0003`;
      } else {
        const c = ['#e8c46a', '#b3342b', '#f7f1e3', '#36507a'];
        s.style.cssText = `width:${3 + Math.random() * 3}px;height:${14 + Math.random() * 16}px;border-radius:1px;background:${c[i % 4]}`;
      }
      host.appendChild(s);
      const ang = floor != null ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const d = (28 + Math.random() * 50) * spread;
      let dx = Math.cos(ang) * d;
      let dy = Math.sin(ang) * d + (floor != null ? 10 : 34 * spread);
      if (floor != null) {
        dx *= 1.3;
        dy = Math.min(dy, floor - y);
      }
      const r = (Math.random() * 540 - 270) | 0;
      const a = anim(
        s,
        [
          { transform: `translate(${x}px,${y}px) rotate(0)`, opacity: 1 },
          { transform: `translate(${x + dx}px,${y + dy}px) rotate(${r}deg)`, opacity: 0 },
        ],
        { duration: 560 + Math.random() * 380, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
      if (a) a.onfinish = () => s.remove();
      else s.remove();
    }
  },

  /** 공항 글자판: el(.lp-flap) 안의 칸들을 몇 번 넘긴 뒤 text 에 멈춘다. 돌려받은 함수를 부르면 바로 끝 상태 */
  flip(el: HTMLElement, text: string, delayMs = 0): () => void {
    const timers: number[] = [];
    const isNum = (c: string) => /[0-9]/.test(c);
    el.innerHTML = text
      .split('')
      .map((c) => `<span class="lp-flap-tile${isNum(c) ? '' : ' is-sep'}"><span>${isNum(c) ? '0' : c}</span></span>`)
      .join('');
    const finish = () => {
      timers.forEach(clearTimeout);
      Array.from(el.children).forEach((t, i) => { (t.firstChild as HTMLElement).textContent = text[i]; });
    };
    if (reduced()) { finish(); return finish; }
    Array.from(el.children).forEach((tile, i) => {
      const target = text[i];
      if (!isNum(target)) return;
      const face = tile.firstChild as HTMLElement;
      const spins = 3 + i * 2 + ((Math.random() * 3) | 0);
      for (let k = 1; k <= spins; k++) {
        timers.push(window.setTimeout(() => {
          face.textContent = k === spins ? target : String((+target + k + 3) % 10);
          anim(face, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(-80deg)', offset: 0.45 }, { transform: 'rotateX(0)' }], { duration: 55 });
          if (k % 2) sfx.flap();
        }, delayMs + k * 55));
      }
    });
    return finish;
  },

  /** 연속 단계: 5·10·20·50 → 1·2·3·4 */
  tier(n: number): number {
    return n >= 50 ? 4 : n >= 20 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0;
  },

  /** 단계마다 켜지는 전구 수 */
  litBulbs(n: number): number {
    return [0, 3, 5, 8, 10][fx.tier(n)];
  },

  /**
   * 결과 공개 순서표. steps = [[ms, 함수], …]. 돌려받은 skip() 을 부르면 남은 단계를 건너뛰고 end() 를 한 번 부른다.
   * 결과 화면의 keydown·pointerdown(아무 키) 에 skip 을 건다. 움직임 줄이기면 곧장 끝 상태.
   */
  sequence(steps: [number, () => void][], end?: () => void): () => void {
    const timers: number[] = [];
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      end?.();
    };
    if (reduced()) { close(); return close; }
    for (const [ms, f] of steps) timers.push(window.setTimeout(f, ms));
    const last = steps.reduce((m, s) => Math.max(m, s[0]), 0);
    timers.push(window.setTimeout(close, last + 400));
    return close;
  },

  reduced,
};
