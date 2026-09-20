import { blankImage, db, type ImageSet, type MemoImage } from '../db/db';

/* ── 파일 저장/열기 ── */

export function download(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? (await f.text()).replace(/^﻿/, '') : null);
    };
    input.click();
  });
}

/* ── CSV ── */

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(images: MemoImage[]): string {
  const head = 'key,name,aliases,note,tags';
  const rows = [...images]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((i) =>
      [i.key, i.name, i.aliases.join('|'), i.note, i.tags.join('|')].map(esc).join(','),
    );
  return [head, ...rows].join('\n');
}

/** RFC4180 기본형 파서 (따옴표·이스케이프·줄바꿈 포함 필드 지원) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ImportRow { key: string; name: string; aliases: string[]; note: string; tags: string[] }

export function rowsFromCsv(text: string): ImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('key') && header.includes('name');
  const idx = (n: string, fallback: number) => (hasHeader ? header.indexOf(n) : fallback);
  const iKey = idx('key', 0), iName = idx('name', 1);
  const iAlias = idx('aliases', 2), iNote = idx('note', 3), iTags = idx('tags', 4);
  const split = (s?: string) => (s ?? '').split('|').map((x) => x.trim()).filter(Boolean);
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => ({
      key: (r[iKey] ?? '').trim(),
      name: (r[iName] ?? '').trim(),
      aliases: split(r[iAlias]),
      note: (r[iNote] ?? '').trim(),
      tags: split(r[iTags]),
    }))
    .filter((r) => r.key !== '');
}

/** 가져오기: 같은 key 는 덮어쓰고, 없는 key 는 새로 만든다. 빈 name 행은 건너뛴다. */
export async function importRows(setId: string, rows: ImportRow[]): Promise<{ updated: number; created: number }> {
  let updated = 0, created = 0;
  await db.transaction('rw', db.images, async () => {
    const existing = await db.images.where('setId').equals(setId).toArray();
    const byKey = new Map(existing.map((i) => [i.key, i]));
    for (const r of rows) {
      if (!r.name) continue;
      const cur = byKey.get(r.key);
      if (cur) {
        await db.images.put({ ...cur, ...r, updatedAt: Date.now() });
        updated++;
      } else {
        await db.images.add({ ...blankImage(setId, r.key), ...r, updatedAt: Date.now() });
        created++;
      }
    }
  });
  return { updated, created };
}

/* ── 전체 백업 ── */

export async function exportBackup(): Promise<string> {
  const [imageSets, images, drillSessions, drillAttempts, recallSessions, recallCells, palaces, loci, imageStats, settings] =
    await Promise.all([
      db.imageSets.toArray(), db.images.toArray(), db.drillSessions.toArray(), db.drillAttempts.toArray(),
      db.recallSessions.toArray(), db.recallCells.toArray(), db.palaces.toArray(), db.loci.toArray(),
      db.imageStats.toArray(), db.settings.toArray(),
    ]);
  return JSON.stringify(
    { format: 'memory-gym', version: 1, exportedAt: new Date().toISOString(),
      imageSets, images, drillSessions, drillAttempts, recallSessions, recallCells, palaces, loci, imageStats, settings },
    null, 2,
  );
}

export async function importBackup(json: string): Promise<void> {
  const d = JSON.parse(json);
  if (d.format !== 'memory-gym') throw new Error('이 앱의 백업 파일이 아닙니다.');
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    await db.imageSets.bulkAdd(d.imageSets ?? []);
    await db.images.bulkAdd(d.images ?? []);
    await db.drillSessions.bulkAdd(d.drillSessions ?? []);
    await db.drillAttempts.bulkAdd(d.drillAttempts ?? []);
    await db.recallSessions.bulkAdd(d.recallSessions ?? []);
    await db.recallCells.bulkAdd(d.recallCells ?? []);
    await db.palaces.bulkAdd(d.palaces ?? []);
    await db.loci.bulkAdd(d.loci ?? []);
    await db.imageStats.bulkAdd(d.imageStats ?? []);
    await db.settings.bulkAdd(d.settings ?? []);
  });
}

export function setFileBase(set: ImageSet): string {
  return set.name.replace(/[^\w가-힣-]+/g, '_');
}
