/**
 * 남은 기록으로 연속 정답을 다시 센다.
 * 뒤로 가서 판정을 고치면 화면의 연속 숫자도 같이 어긋나므로, 그때마다 처음부터 다시 센다.
 */
export function streaks(oks: boolean[]): { cur: number; best: number } {
  let cur = 0;
  let best = 0;
  for (const ok of oks) {
    if (ok) { cur += 1; best = Math.max(best, cur); }
    else cur = 0;
  }
  return { cur, best };
}
