import { useEffect } from 'react';

/**
 * 훈련 중에는 전역 화면 이동 단축키(1~7)를 잠근다.
 * 채점 화면의 원인 태그 1~4 처럼 같은 키를 쓰는 화면이 있고,
 * 드릴·암기 도중 숫자키를 잘못 눌러 진행이 날아가는 것도 막아야 한다.
 */
let locks = 0;

export const navLocked = () => locks > 0;

export function useNavLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    locks++;
    return () => { locks--; };
  }, [active]);
}
