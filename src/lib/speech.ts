import type { SpokenLang } from './spoken';

/*
 * 브라우저 음성 합성을 얇게 감싼다. 박자는 lib/spoken 의 createReader 가 정하고 여기는 말만 한다.
 */

const LOCALE: Record<SpokenLang, string> = { ko: 'ko-KR', en: 'en-US' };

export const speechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/** 누름 처리기 안에서 바로 부른다 — 아이폰 사파리는 사용자 동작 안의 첫 발화가 있어야 뒤 발화가 난다. */
export function unlockSpeech(): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

/** 그 언어 목소리(기기 안 목소리 우선). 목록이 비어 있으면 voiceschanged 를 1.5초까지 기다린다. 없으면 null. */
export async function pickVoice(lang: SpokenLang): Promise<SpeechSynthesisVoice | null> {
  if (!speechSupported()) return null;
  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener('voiceschanged', done);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(done, 1500);
      synth.addEventListener('voiceschanged', done);
    });
  }
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return mine.find((v) => v.localService) ?? mine[0] ?? null;
}

/** 이전 발화가 남아 있으면 끊고 새로 말한다(밀리면 박자가 무너진다). */
export function speakWord(word: string, voice: SpeechSynthesisVoice | null, lang: SpokenLang): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) synth.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = LOCALE[lang];
  if (voice) u.voice = voice;
  u.rate = 1;
  synth.speak(u);
}

export function stopSpeech(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
