/**
 * 소리·움직임 설정의 현재 값. 앱 설정(Dexie)이 바뀌면 App 이 여기에 넣고,
 * 소리(sfx)·연출(fx)은 부를 때마다 이 값을 본다. 전역 창(window)에 매달지 않는다.
 */
export const designSettings = {
  /** 효과음. 앱 설정 soundOn — 기본 켬(디자인 시스템 기본값). */
  sound: true,
  /** 앱 설정 reduceMotion. undefined = 기기 설정(prefers-reduced-motion)을 따른다. */
  reduceMotion: undefined as boolean | undefined,
};

const rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** 움직임 줄이기가 켜졌는가. 앱 설정이 기기 설정보다 앞선다. */
export function reduced(): boolean {
  if (designSettings.reduceMotion !== undefined) return designSettings.reduceMotion;
  return !!rmq?.matches;
}
