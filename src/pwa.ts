import { registerSW } from 'virtual:pwa-register';

/**
 * 새 버전을 제때 가져오게 한다.
 *
 * 이 앱은 서비스워커가 화면을 통째로 미리 받아 두기 때문에, 배포를 해도 브라우저가 **옛 화면을
 * 계속 꺼내 쓴다.** 새로고침을 해도 마찬가지다 — 서비스워커가 새 것이 있는지 물어보는 시점이
 * 따로 있기 때문이다. 실제로 회장이 새로고침을 해도 옛 화면을 보셨다.
 *
 * 그래서 **열 때와 탭으로 돌아올 때마다** 직접 물어본다. 새 것이 있으면 autoUpdate 설정이
 * 받아서 바로 갈아 끼운다.
 */
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => { reg.update().catch(() => {}); };
    check();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    /* 하루 종일 켜 두시는 경우를 위한 보험 */
    setInterval(check, 60 * 60 * 1000);
  },
});
