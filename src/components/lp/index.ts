/*
 * Lampadas 부품 모음 — 1950년대 계산실 디자인 시스템의 React 판.
 * 원본: https://claude.ai/artifact/BkPiAec2kapUZoaeZgKem9 (규칙 6편 · 부품 16), 저장소 사본 design-reference/.
 *
 * 둘러보는 화면(홈·목록·기록): TvImage/TvVideo · 제목 · TearCalendar + Gauge · Folder + SageNote + Key · Dymo + IndexCard
 * 측정 화면(드릴·암기·회상·계산): Hud(계수기·판정) · QuestionCard(움직이지 않음) · Held · useJudge().layer
 * 결과 화면: ResultSheet(outcome) — 글자판·목표 막대·금별·도장·아까움·신기록 무대
 * 모의 대회: useFullscreen · Countdown → 판정 연출 없이 → ResultSheet
 */
export { art, Key, KeyLink, pressVisual, Dymo, Folder, IndexCard, TearCalendar, Gauge, TvImage, TvVideo, SageNote, Stamp, Star } from './basic';
export type { KeyTone, KeySize } from './basic';
export { ComboCounter, useJudge, Hud, QuestionCard, Held } from './measure';
export type { Judge, JudgeKind, JudgeState } from './measure';
export { ResultSheet } from './result';
export { Countdown, useFullscreen, useFocusMode } from './contest';
export { default as SvgDefs } from './defs';
