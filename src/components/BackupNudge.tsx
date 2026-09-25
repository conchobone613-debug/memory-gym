import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings } from '../db/db';
import { download, exportBackup } from '../lib/io';
import { Key } from './lp';

const DAY = 86_400_000;
const REMIND_AFTER = 14 * DAY;

/**
 * 데이터는 이 브라우저 안에만 있다. 브라우저를 지우거나 기기를 바꾸면 그대로 사라진다.
 * 회장이 공들여 채운 이미지를 잃는 사고가 한 번이라도 나면 안 되므로, 채운 것이 있는데
 * 백업이 없거나 오래됐으면 눈에 띄게 알린다. 한 번 누르면 파일이 떨어진다.
 * 모양은 경고 쪽지 — 옅은 노랑 종이 + 빨간 점선, 버튼은 크림색 자판(빨간 자판은 화면의 주 동작 몫).
 */
export default function BackupNudge() {
  const settings = useLiveQuery(() => getSettings(), []);
  const filled = useLiveQuery(async () => (await db.images.filter((i) => !!i.name.trim()).count()), [], 0);

  if (!settings || filled === 0) return null;
  const last = settings.lastBackupAt ?? 0;
  if (last && Date.now() - last < REMIND_AFTER) return null;

  const run = async () => {
    download(
      `memory-gym-backup-${new Date().toISOString().slice(0, 10)}.json`,
      await exportBackup(),
      'application/json',
    );
    await saveSettings({ lastBackupAt: Date.now() });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-dashed border-red bg-near px-3 py-2.5">
      <p className="m-0 min-w-48 flex-1 font-typek text-xs leading-relaxed text-ink">
        <b>이 기록은 지금 이 브라우저 안에만 있습니다.</b>{' '}
        <span className="text-ink-2">
          {last
            ? '마지막 백업이 2주 넘었습니다. 브라우저를 비우거나 기기를 바꾸면 사라집니다.'
            : `채우신 이미지 ${filled}개에 아직 백업이 없습니다. 브라우저를 비우거나 기기를 바꾸면 사라집니다.`}
        </span>
      </p>
      <Key tone="cream" size="sm" onClick={run}>지금 백업 받기</Key>
    </div>
  );
}
