import { blankImage, db, type ImageSet, type MemoImage } from '../db/db';

/* ── 파일 저장/열기 ── */

/** bom = false: BOM 을 이미 붙인 글(exportCsv)이거나, BOM 을 받지 않는 JSON 파서가 읽을 파일 */
export function download(filename: string, text: string, mime = 'text/plain;charset=utf-8', bom = true): void {
  const url = URL.createObjectURL(new Blob([(bom ? '﻿' : '') + text], { type: mime }));
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

/**
 * 모든 표를 빠짐없이 내보낸다. 표 이름을 손으로 나열하면 새 표가 생길 때 빠진다 —
 * 실제로 자음 매핑 기록(v2)이 백업에서 빠져 있었다(2026-09-25 발견).
 */
export async function exportBackup(): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const t of db.tables) tables[t.name] = await t.toArray();
  /*
   * 백업 파일은 밖으로 나간다 — 메일로 보내거나 공용 드라이브에 둘 수 있다.
   * AI 키는 비밀이므로 빼고 내보낸다. 새 기기에서는 설정에 다시 넣는다.
   */
  tables.settings = (tables.settings as { aiKey?: string }[]).map(({ aiKey: _k, ...rest }) => rest);
  return JSON.stringify(
    { format: 'memory-gym', version: 2, exportedAt: new Date().toISOString(), ...tables },
    null, 2,
  );
}

/**
 * 파일에 **들어 있는 표만** 비우고 채운다. 파일에 없는 표는 건드리지 않는다.
 * 옛 백업(version 1)에는 자음 매핑 기록이 없어서, 전부 비우고 채우면 그 기록이 통째로 사라졌다.
 */
export async function importBackup(json: string): Promise<void> {
  const d = JSON.parse(json);
  if (d.format !== 'memory-gym') throw new Error('이 앱의 백업 파일이 아닙니다.');
  const present = db.tables.filter((t) => Array.isArray(d[t.name]));
  const keepKey = (await db.settings.get('app'))?.aiKey;
  await db.transaction('rw', db.tables, async () => {
    for (const t of present) {
      await t.clear();
      await t.bulkAdd(d[t.name]);
    }
    /* 키는 파일에 없으므로, 복원했다고 이 기기에 넣어 둔 키가 사라지지 않게 한다 */
    if (keepKey && present.some((t) => t.name === 'settings')) {
      const s = await db.settings.get('app');
      if (s) await db.settings.put({ ...s, aiKey: keepKey });
    }
  });
}

export function setFileBase(set: ImageSet): string {
  return set.name.replace(/[^\w가-힣-]+/g, '_');
}
