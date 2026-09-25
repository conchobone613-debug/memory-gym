import { designSettings } from './settings';

/*
 * 효과음 — 모두 브라우저에서 즉석 합성한다(내려받을 파일 0, 지연 최소).
 * 디자인 시스템 bundle.js 의 BrainGym.sfx 를 옮긴 것. 소리 설계는 「소리」 규칙 참고.
 * 소리는 사람이 들어 보고 확정한다 — AI 는 합성 코드만 만들 수 있고 들을 수 없다.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ac: AudioContext | null = null;

/** 첫 사용자 입력 때 만든다. 효과음을 끄면 아무것도 만들지 않는다. */
function A(): AudioContext | null {
  if (!designSettings.sound) return null;
  if (!ac) {
    try {
      const C = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      ac = C ? new C({ latencyHint: 'interactive' }) : null;
    } catch {
      ac = null;
    }
  }
  if (ac && ac.state === 'suspended') void ac.resume();
  return ac;
}

interface OscOpts { at?: number; dur?: number; vol?: number; lp?: number; type?: OscillatorType; partials?: [number, number][] }

function osc(f: number, o: OscOpts = {}) {
  const a = A();
  if (!a) return;
  const t = a.currentTime + (o.at ?? 0);
  const dur = o.dur ?? 0.4;
  const vol = o.vol ?? 0.15;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
  g.connect(a.destination);
  let dest: AudioNode = g;
  if (o.lp) {
    const fl = a.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = o.lp;
    fl.connect(g);
    dest = fl;
  }
  for (const [mul, amp] of o.partials ?? [[1, 1]]) {
    const n = a.createOscillator();
    const pg = a.createGain();
    n.type = o.type ?? 'sine';
    n.frequency.value = f * mul;
    pg.gain.value = amp;
    n.connect(pg);
    pg.connect(dest);
    n.start(t);
    n.stop(t + dur + 0.05);
  }
}

function burst(at: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass') {
  const a = A();
  if (!a) return;
  const t = a.currentTime + at;
  const n = Math.max(1, (a.sampleRate * dur) | 0);
  const b = a.createBuffer(1, n, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = a.createBufferSource();
  s.buffer = b;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(f);
  f.connect(g);
  g.connect(a.destination);
  s.start(t);
}

const jit = () => 1 + (Math.random() - 0.5) * 0.12;
/** 5음계 12칸. 그 위로는 멈춘다 */
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
const hz = (s: number, base = 1046.5) => base * Math.pow(2, s / 12);
const bell = (f: number, at = 0, vol = 0.1) => osc(f, { dur: 0.9, vol, at, partials: [[1, 1], [2.76, 0.3], [5.4, 0.1]] });

/**
 * 타자기 한 타 — 네 겹: ① 활자대가 종이를 때리는 딱(4ms) ② 활자대 금속 탁(1.8kHz) ③ 몸통 퉁(140→70Hz)
 * ④ 캐리지 톱니 두 번(28·41ms 뒤). 칠 때마다 음높이·세기를 ±6% 흔든다.
 */
function typeKey(heavy: boolean, delay = 0) {
  const a = A();
  if (!a) return;
  const v = heavy ? 1.35 : 1;
  const t = a.currentTime + delay;
  burst(delay, 0.004, 2500 * jit(), 0.5, 0.5 * v * jit(), 'highpass');
  burst(delay + 0.001, 0.022, 1800 * jit(), 2.2, 0.28 * v * jit());
  burst(delay + 0.002, 0.05, 380 * jit(), 0.8, 0.22 * v * jit(), 'lowpass');
  const o = a.createOscillator();
  const g = a.createGain();
  o.frequency.setValueAtTime(140 * jit(), t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
  g.gain.setValueAtTime(0.18 * v, t);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 0.07);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + 0.08);
  for (const f of [3200, 4700]) osc(f * jit(), { dur: 0.06, vol: 0.012 * v, at: delay });
  burst(delay + 0.028, 0.004, 3600, 3, 0.07);
  burst(delay + 0.041, 0.003, 4100, 3, 0.05);
}

export const sfx = {
  /** 모든 누름. 큰 버튼은 key(true) */
  key: (heavy = false) => typeKey(heavy),
  /** 연속 단계 돌파: 톱니가 드르륵 감기고 레버가 탕, 끝에 종 */
  carriage: () => {
    for (let i = 0; i < 9; i++) burst(i * 0.022, 0.006, 3000 + i * 90, 3, 0.06);
    typeKey(true, 0.2);
    bell(hz(24), 0.3, 0.09);
  },
  /** 정답. n = 지금 연속 수(1부터). 한 칸씩 올라가 12칸에서 멈춘다 */
  good: (n: number) => bell(hz(STEPS[Math.min(Math.max(n, 1) - 1, 11)])),
  /** 오답: 짧은 퀴즈쇼 부저(118Hz 사각파 두 개, 4% 어긋남, 700Hz 아래만) */
  bad: () => osc(118, { type: 'square', dur: 0.24, vol: 0.06, partials: [[1, 1], [1.04, 0.8]], lp: 700 }),
  /** 모름(Tab): 종이 넘기는 쉭 */
  skip: () => burst(0, 0.09, 1200, 0.6, 0.08),
  /** 결과 글자판 한 칸 넘김 */
  flap: () => burst(0, 0.016, 2200, 1.4, 0.06),
  /** 숫자 올라갈 때 계수기 딸깍. i 가 클수록 조금 높게 */
  tick: (i = 0) => burst(0, 0.012, 3800 + i * 60, 2, 0.07),
  /** 금별 한 장. i = 0,1,2 */
  star: (i: number) => bell(hz([7, 12, 16][i] ?? 19, 784), 0, 0.08),
  /** 고무도장 쾅 */
  stamp: () => {
    osc(90, { dur: 0.18, vol: 0.35 });
    burst(0, 0.05, 600, 0.6, 0.12);
  },
  /** 좋아진 항목 표시 */
  better: () => bell(hz(12), 0, 0.07),
  /** 아까움: 시계 똑딱 여섯 번 */
  tense: () => {
    for (let i = 0; i < 6; i++) burst(i * 0.16, 0.012, i % 2 ? 1800 : 2600, 3, 0.08);
  },
  /** 신기록 팡파르: 금관 느낌의 톱니파 아르페지오 + 화음 + 종 */
  fanfare: () => {
    [0, 4, 7, 12].forEach((s, i) => osc(hz(s, 392), { type: 'sawtooth', dur: 0.22, vol: 0.05, at: i * 0.12, lp: 1800 }));
    [0, 4, 7, 12].forEach((s) => osc(hz(s, 392), { type: 'sawtooth', dur: 1.1, vol: 0.035, at: 0.5, lp: 2200 }));
    bell(hz(12), 0.5, 0.1);
  },
};
