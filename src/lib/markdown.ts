import { confusionPairs, dailyRows, localDayKey, movers } from '../db/analytics';
import { db, ERROR_TAG_LABEL, type ErrorTag } from '../db/db';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => (x ? `${(x / 1000).toFixed(2)}초` : '—');

/** 노션에 그대로 붙여 넣는 주간 요약. 순수 마크다운 표만 쓴다. */
export async function weeklyMarkdown(days = 7): Promise<string> {
  const rows = await dailyRows(days);
  const [pairs, mv] = await Promise.all([confusionPairs(5), movers(5)]);

  const since = Date.now() - days * 86_400_000;
  const sessions = (await db.recallSessions.where('startedAt').above(since).toArray())
    .sort((a, b) => a.startedAt - b.startedAt);
  const cells = sessions.length
    ? await db.recallCells.filter((c) => sessions.some((s) => s.id === c.sessionId)).toArray()
    : [];

  const totalAttempts = rows.reduce((s, r) => s + r.attempts, 0);
  const totalCorrect = rows.reduce((s, r) => s + r.correct, 0);
  const activeRts = rows.filter((r) => r.medianRt > 0).map((r) => r.medianRt);
  const avgRt = activeRts.length ? Math.round(activeRts.reduce((a, b) => a + b, 0) / activeRts.length) : 0;

  const tagCount = new Map<ErrorTag, number>();
  for (const c of cells) for (const t of c.errorTags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

  const L: string[] = [];
  L.push(`# 기억력 훈련 주간 요약 (${rows[0].day} ~ ${rows[rows.length - 1].day})`, '');
  L.push('## 한눈에', '');
  L.push('| 항목 | 값 |', '| --- | --- |');
  L.push(`| 변환 드릴 시도 | ${totalAttempts}회 |`);
  L.push(`| 정확도 | ${totalAttempts ? pct(totalCorrect / totalAttempts) : '—'} |`);
  L.push(`| 평균 반응시간(일별 중앙값 평균) | ${ms(avgRt)} |`);
  L.push(`| 종목 세션 | ${sessions.length}회 |`, '');

  L.push('## 일별 추이', '');
  L.push('| 날짜 | 시도 | 정확도 | 중앙 반응시간 | 종목 |', '| --- | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    L.push(`| ${r.day} | ${r.attempts} | ${r.attempts ? pct(r.accuracy) : '—'} | ${ms(r.medianRt)} | ${r.practiceSessions} |`);
  }
  L.push('');

  if (mv.slowest.length) {
    L.push('## 가장 느린 이미지 5', '');
    L.push('| 키 | 이미지 | 중앙 반응시간 | 시도 |', '| --- | --- | ---: | ---: |');
    for (const m of mv.slowest) L.push(`| ${m.key} | ${m.name} | ${ms(m.medianRt)} | ${m.attempts} |`);
    L.push('');
  }
  if (mv.worst.length) {
    L.push('## 오답률 높은 이미지 5', '');
    L.push('| 키 | 이미지 | 오답률 | 시도 |', '| --- | --- | ---: | ---: |');
    for (const m of mv.worst) L.push(`| ${m.key} | ${m.name} | ${pct(m.errRate)} | ${m.attempts} |`);
    L.push('');
  }
  if (pairs.length) {
    L.push('## 혼동 쌍 Top 5', '');
    L.push('| 정답 | 답한 것 | 횟수 | 출처 |', '| --- | --- | ---: | --- |');
    for (const p of pairs) L.push(`| ${p.expected} | ${p.answered} | ${p.count} | ${p.source} |`);
    L.push('');
  }
  if (sessions.length) {
    L.push('## 종목 기록', '');
    L.push('| 날짜 | 모드 | 정답 | 오답 | 미기입 | 정확도 |', '| --- | --- | ---: | ---: | ---: | ---: |');
    for (const s of sessions) {
      const total = s.correct + s.wrong + s.blank;
      L.push(`| ${localDayKey(s.startedAt)} | ${s.presetName} | ${s.correct} | ${s.wrong} | ${s.blank} | ${total ? pct(s.correct / total) : '—'} |`);
    }
    L.push('');
  }
  if (tagCount.size) {
    L.push('## 오답 원인', '');
    L.push('| 원인 | 횟수 |', '| --- | ---: |');
    for (const [t, n] of [...tagCount.entries()].sort((a, b) => b[1] - a[1])) {
      L.push(`| ${ERROR_TAG_LABEL[t]} | ${n} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
