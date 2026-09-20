/**
 * Firebase 웹 설정.
 *
 * 이 값들은 공개돼도 되는 값이다 — 브라우저에 그대로 실려 나가는 식별자이고, 실제 보호는
 * Firestore 규칙이 한다. 규칙은 `firestore.rules` 에 있고 동기화 코드를 아는 쪽만 읽고 쓴다.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD8Lp36d-qcQaYheDXeyIkL5Tn8UwwIAyk',
  authDomain: 'memory-gym-sync.firebaseapp.com',
  projectId: 'memory-gym-sync',
  storageBucket: 'memory-gym-sync.firebasestorage.app',
  messagingSenderId: '163157400189',
  appId: '1:163157400189:web:c0511426204b7801706f14',
} as const;

/** 동기화 코드. 128비트 난수를 32자 16진수로 쓴다. */
export function newSyncCode(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const isValidSyncCode = (s: string) => /^[0-9a-f]{32}$/.test(s.trim().toLowerCase());
