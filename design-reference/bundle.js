/* @ds-bundle: {"format":4,"namespace":"BrainGym","components":[]} */
/*
 * 계산실 디자인 시스템 — 소리(sfx)와 연출(fx) 도구.
 * 화면 부품은 bundle.css 의 클래스로 쓴다. 여기에는 부품이 공통으로 부르는 두 가지만 있다.
 *
 *   BrainGym.sfx  — 모든 효과음을 브라우저에서 즉석 합성한다(내려받을 파일 0, 지연 최소).
 *   BrainGym.fx   — 입력을 막지 않는 연출 층에서 도는 연출(가장자리 빛, 조각 튀기기, 글자판 넘김, 숫자 올리기, 결과 공개 순서).
 *
 * 앱으로 옮길 때: TypeScript 모듈 두 개(sfx.ts / fx.ts)로 나누면 된다. 전역에 매달 필요는 없다.
 * 설정 두 개를 반드시 연결한다 — BrainGym.settings.sound(효과음 켬/끔) · BrainGym.settings.reduced(움직임 줄이기).
 */
(function () {
  var settings = { sound: true, reduced: false };
  var rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return settings.reduced || !!(rmq && rmq.matches); }

  /* ── 소리 ───────────────────────────────────────── */
  var ac = null;
  function A() {
    if (!settings.sound) return null;
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function osc(f, o) {
    o = o || {}; var a = A(); if (!a) return;
    var t = a.currentTime + (o.at || 0), dur = o.dur || .4, vol = o.vol || .15;
    var g = a.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .003); g.gain.exponentialRampToValueAtTime(.0004, t + dur); g.connect(a.destination);
    var dest = g;
    if (o.lp) { var fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; fl.connect(g); dest = fl; }
    (o.partials || [[1, 1]]).forEach(function (p) {
      var n = a.createOscillator(), pg = a.createGain(); n.type = o.type || 'sine'; n.frequency.value = f * p[0]; pg.gain.value = p[1];
      n.connect(pg); pg.connect(dest); n.start(t); n.stop(t + dur + .05);
    });
  }
  function burst(at, dur, freq, q, vol, type) {
    var a = A(); if (!a) return; var t = a.currentTime + at;
    var n = Math.max(1, (a.sampleRate * dur) | 0), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    var s = a.createBufferSource(); s.buffer = b; var f = a.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = a.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  }
  var jit = function () { return 1 + (Math.random() - .5) * .12; };
  var STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26]; // 5음계 12칸. 그 위로는 멈춘다
  var hz = function (s, base) { return (base || 1046.5) * Math.pow(2, s / 12); };
  var bell = function (f, at, vol) { osc(f, { dur: .9, vol: vol || .1, at: at || 0, partials: [[1, 1], [2.76, .3], [5.4, .1]] }); };

  /*
   * 타자기 한 타 — 네 겹: ① 활자대가 종이를 때리는 딱(4ms) ② 활자대 금속 탁(1.8kHz) ③ 몸통 퉁(140→70Hz)
   * ④ 캐리지 톱니 두 번(28·41ms 뒤). 칠 때마다 음높이·세기를 ±6% 흔든다.
   */
  function typeKey(heavy, delay) {
    var a = A(); if (!a) return; delay = delay || 0; var v = heavy ? 1.35 : 1, t = a.currentTime + delay;
    burst(delay, .004, 2500 * jit(), .5, .5 * v * jit(), 'highpass');
    burst(delay + .001, .022, 1800 * jit(), 2.2, .28 * v * jit());
    burst(delay + .002, .05, 380 * jit(), .8, .22 * v * jit(), 'lowpass');
    var o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(140 * jit(), t); o.frequency.exponentialRampToValueAtTime(70, t + .06);
    g.gain.setValueAtTime(.18 * v, t); g.gain.exponentialRampToValueAtTime(.0004, t + .07); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + .08);
    [3200, 4700].forEach(function (f) { osc(f * jit(), { dur: .06, vol: .012 * v, at: delay }); });
    burst(delay + .028, .004, 3600, 3, .07); burst(delay + .041, .003, 4100, 3, .05);
  }

  var sfx = {
    /** 모든 누름. 큰 버튼은 key(true) */
    key: function (heavy) { typeKey(!!heavy); },
    /** 연속 단계 돌파: 톱니가 드르륵 감기고 레버가 탕, 끝에 종 */
    carriage: function () { for (var i = 0; i < 9; i++) burst(i * .022, .006, 3000 + i * 90, 3, .06); typeKey(true, .2); bell(hz(24), .3, .09); },
    /** 정답. n = 지금 연속 수(1부터). 한 칸씩 올라가 12칸에서 멈춘다 */
    good: function (n) { bell(hz(STEPS[Math.min(Math.max(n, 1) - 1, 11)])); },
    /** 오답: 짧은 퀴즈쇼 부저(118Hz 사각파 두 개, 4% 어긋남, 700Hz 아래만) */
    bad: function () { osc(118, { type: 'square', dur: .24, vol: .06, partials: [[1, 1], [1.04, .8]], lp: 700 }); },
    /** 모름(Tab): 종이 넘기는 쉭 */
    skip: function () { burst(0, .09, 1200, .6, .08); },
    /** 결과 글자판 한 칸 넘김 */
    flap: function () { burst(0, .016, 2200, 1.4, .06); },
    /** 숫자 올라갈 때 계수기 딸깍. i 가 클수록 조금 높게 */
    tick: function (i) { burst(0, .012, 3800 + (i || 0) * 60, 2, .07); },
    /** 금별 한 장. i = 0,1,2 */
    star: function (i) { bell(hz([7, 12, 16][i] || 19, 784), 0, .08); },
    /** 고무도장 쾅 */
    stamp: function () { osc(90, { dur: .18, vol: .35 }); burst(0, .05, 600, .6, .12); },
    /** 좋아진 항목 표시 */
    better: function () { bell(hz(12), 0, .07); },
    /** 아까움: 시계 똑딱 여섯 번 */
    tense: function () { for (var i = 0; i < 6; i++) burst(i * .16, .012, i % 2 ? 1800 : 2600, 3, .08); },
    /** 신기록 팡파르: 금관 느낌의 톱니파 아르페지오 + 화음 + 종 */
    fanfare: function () {
      [0, 4, 7, 12].forEach(function (s, i) { osc(hz(s, 392), { type: 'sawtooth', dur: .22, vol: .05, at: i * .12, lp: 1800 }); });
      [0, 4, 7, 12].forEach(function (s) { osc(hz(s, 392), { type: 'sawtooth', dur: 1.1, vol: .035, at: .5, lp: 2200 }); });
      bell(hz(12), .5, .1);
    },
  };

  /* ── 연출 ───────────────────────────────────────── */
  function anim(el, frames, opt) { return el && el.animate ? el.animate(frames, opt) : null; }

  var fx = {
    /** 가장자리 빛 한 번. el = .bg-edge 요소 */
    flash: function (el, peak, dur) {
      anim(el, [{ opacity: 0 }, { opacity: peak || 1, offset: .3 }, { opacity: 0 }], { duration: reduced() ? 400 : (dur || 240), easing: 'ease-out' });
    },
    /**
     * 조각 튀기기. host = 연출 층(.bg-fx), (x,y) = host 기준 출발점, kind = 'chad'(천공 카드 조각) | 'tape'(색종이 테이프).
     * floor 를 주면 위쪽 반원으로만 튀고 그 y 아래로는 내려가지 않는다 — 측정 화면에서 문제 카드 윗선을 넘기면 안 된다.
     */
    spray: function (host, x, y, count, kind, spread, floor) {
      if (reduced() || !host) return; spread = spread || 1;
      for (var i = 0; i < count; i++) {
        var s = document.createElement('span'); s.className = 'bg-bit';
        if (kind === 'chad') { var w = 5 + Math.random() * 4; s.style.cssText = 'width:' + w * 1.6 + 'px;height:' + w + 'px;border-radius:2px;background:' + (Math.random() < .7 ? '#efe2c2' : '#e8c46a') + ';box-shadow:0 0 0 .5px #0003'; }
        else { var c = ['#e8c46a', '#b3342b', '#f7f1e3', '#36507a']; s.style.cssText = 'width:' + (3 + Math.random() * 3) + 'px;height:' + (14 + Math.random() * 16) + 'px;border-radius:1px;background:' + c[i % 4]; }
        host.appendChild(s);
        var ang = floor != null ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2, d = (28 + Math.random() * 50) * spread;
        var dx = Math.cos(ang) * d, dy = Math.sin(ang) * d + (floor != null ? 10 : 34 * spread);
        if (floor != null) { dx *= 1.3; dy = Math.min(dy, floor - y); }
        var r = (Math.random() * 540 - 270) | 0;
        var a = anim(s, [{ transform: 'translate(' + x + 'px,' + y + 'px) rotate(0)', opacity: 1 }, { transform: 'translate(' + (x + dx) + 'px,' + (y + dy) + 'px) rotate(' + r + 'deg)', opacity: 0 }],
          { duration: 560 + Math.random() * 380, easing: 'cubic-bezier(.2,.7,.3,1)' });
        (function (node) { if (a) a.onfinish = function () { node.remove(); }; else node.remove(); })(s);
      }
    },
    /** 공항 글자판: el(.bg-flap) 안의 칸들을 몇 번 넘긴 뒤 text 에 멈춘다. 돌려받은 함수를 부르면 바로 끝 상태 */
    flip: function (el, text, delay) {
      var timers = [];
      el.innerHTML = text.split('').map(function (c) { return '<span class="bg-flap-tile' + (/[0-9]/.test(c) ? '' : ' is-sep') + '"><span>' + (/[0-9]/.test(c) ? '0' : c) + '</span></span>'; }).join('');
      var finish = function () { timers.forEach(clearTimeout); Array.prototype.forEach.call(el.children, function (t, i) { t.firstChild.textContent = text[i]; }); };
      if (reduced()) { finish(); return finish; }
      Array.prototype.forEach.call(el.children, function (tile, i) {
        var target = text[i]; if (!/[0-9]/.test(target)) return;
        var face = tile.firstChild, spins = 3 + i * 2 + ((Math.random() * 3) | 0);
        for (var k = 1; k <= spins; k++) (function (k) {
          timers.push(setTimeout(function () {
            face.textContent = k === spins ? target : String((+target + k + 3) % 10);
            anim(face, [{ transform: 'rotateX(0)' }, { transform: 'rotateX(-80deg)', offset: .45 }, { transform: 'rotateX(0)' }], { duration: 55 });
            if (k % 2) sfx.flap();
          }, (delay || 0) + k * 55));
        })(k);
      });
      return finish;
    },
    /** 기계식 계수기(.bg-counter) 값 바꾸기. 바퀴가 굴러가고, 연속 단계에 맞춰 전구가 켜진다 */
    setCounter: function (el, n) {
      var s = String(Math.min(n, 999)); while (s.length < 3) s = '0' + s;
      Array.prototype.forEach.call(el.querySelectorAll('.bg-wheel > span'), function (w, i) { w.style.transform = 'translateY(' + (-24 * Number(s[i])) + 'px)'; });
      var lit = [0, 3, 5, 8, 10][fx.tier(n)];
      Array.prototype.forEach.call(el.querySelectorAll('.bg-bulb'), function (b, i) { b.classList.toggle('is-on', i < lit); });
    },
    /** 연속 단계: 5·10·20·50 */
    tier: function (n) { return n >= 50 ? 4 : n >= 20 ? 3 : n >= 10 ? 2 : n >= 5 ? 1 : 0; },
    /**
     * 결과 공개 순서표. steps = [[ms, 함수], …]. 돌려받은 skip() 을 부르면 남은 단계를 건너뛰고 end() 를 한 번 부른다.
     * 앱에서는 결과 화면의 keydown(아무 키) 에 skip 을 건다.
     */
    sequence: function (steps, end) {
      var timers = [], done = false;
      var close = function () { if (done) return; done = true; timers.forEach(clearTimeout); if (end) end(); };
      if (reduced()) { close(); return close; }
      steps.forEach(function (s) { timers.push(setTimeout(s[1], s[0])); });
      var last = steps.reduce(function (m, s) { return Math.max(m, s[0]); }, 0);
      timers.push(setTimeout(close, last + 400));
      return close;
    },
    reduced: reduced,
  };

  window.BrainGym = { sfx: sfx, fx: fx, settings: settings };
})();
