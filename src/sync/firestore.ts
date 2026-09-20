import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, type Firestore,
} from 'firebase/firestore';
import { FIREBASE_CONFIG } from './config';
import type { Remote } from './engine';

let app: FirebaseApp | null = null;
let fs: Firestore | null = null;

function store(): Firestore {
  if (!fs) {
    app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
    fs = getFirestore(app);
  }
  return fs;
}

/**
 * 동기화 코드 하나가 방 하나다. 로그인이 없고, 규칙이 코드를 아는 쪽만 통과시킨다.
 * 자산은 문서 하나(작고 자주 안 바뀜), 기록은 올릴 때마다 새 문서(추가만 됨).
 */
export function firestoreRemote(code: string): Remote {
  const d = store();
  const root = doc(d, 'sync', code);

  return {
    async getAssets() {
      const snap = await getDoc(doc(root, 'bundles', 'assets'));
      if (!snap.exists()) return null;
      const data = snap.data() as { json: string; updatedAt: number };
      return { bundle: JSON.parse(data.json), updatedAt: data.updatedAt };
    },

    async putAssets(bundle, updatedAt) {
      /* 통째로 JSON 문자열로 넣는다. 배열 안 배열을 Firestore 가 못 받는 문제를 피한다. */
      await setDoc(doc(root, 'bundles', 'assets'), { json: JSON.stringify(bundle), updatedAt });
    },

    async listBatches(after) {
      const q = query(collection(root, 'batches'), where('createdAt', '>', after));
      const snap = await getDocs(q);
      return snap.docs.map((s) => {
        const v = s.data() as { createdAt: number; json: string };
        return { id: s.id, createdAt: v.createdAt, rows: JSON.parse(v.json) };
      });
    },

    async putBatch(id, createdAt, rows) {
      await setDoc(doc(root, 'batches', id), { createdAt, json: JSON.stringify(rows) });
    },
  };
}
