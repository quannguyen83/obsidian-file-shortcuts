import { TFile, type App } from 'obsidian';
import { EXTENSION, resolveShortcut } from './shortcut';

export interface PdfEntry {
  file: TFile;
  title: string;
  key: string;
  timestamp: number;
  dateSource: 'import' | 'created' | 'unknown';
  shortcuts: string[];
}
interface Metadata { vaultPath?: string; attachmentKey?: string; title?: string; importedAt?: string }
export type CatalogFilter = 'all' | 'recent' | 'unlinked';

export function entryFrom(file: TFile, metadata: Metadata = {}, shortcuts: string[] = []): PdfEntry {
  const imported = typeof metadata.importedAt === 'string' ? Date.parse(metadata.importedAt) : NaN;
  const exact = Number.isFinite(imported) && imported > 0;
  const created = file.stat?.ctime ?? 0;
  return {
    file, title: typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : file.basename,
    key: typeof metadata.attachmentKey === 'string' ? metadata.attachmentKey : file.basename,
    timestamp: exact ? imported : created,
    dateSource: exact ? 'import' : created > 0 ? 'created' : 'unknown', shortcuts,
  };
}

export function selectEntries(entries: PdfEntry[], search: string, filter: CatalogFilter, now = Date.now()): PdfEntry[] {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter === 'unlinked' && entry.shortcuts.length) return false;
    if (filter === 'recent' && (entry.timestamp < now - 7 * 86400000 || entry.timestamp > now)) return false;
    const haystack = [entry.title, entry.key, entry.file.path, ...entry.shortcuts].join(' ').toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => b.timestamp - a.timestamp || a.title.localeCompare(b.title));
}

/** The title is a display name; file paths and PDFs are never renamed. */
export function suggestedName(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').slice(0, 160).replace(/[. ]+$/, '');
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `Paper ${name || 'shortcut'}` : name;
}

export async function loadPdfCatalog(app: App): Promise<{ entries: PdfEntry[]; warning: string }> {
  const path = `${app.vault.configDir}/plugins/obsidian-zotero-bridge/data.json`;
  const metadata = new Map<string, Metadata>();
  let warning = '';
  if (await app.vault.adapter.exists(path)) {
    try {
      const data = JSON.parse(await app.vault.adapter.read(path));
      for (const [vaultPath, value] of Object.entries(data.pdfs ?? {})) {
        if (value && typeof value === 'object') metadata.set(vaultPath, value as Metadata);
      }
    } catch {
      warning = 'Could not read Bridge metadata. Showing filenames and file creation dates.';
    }
  } else {
    warning = 'No Bridge metadata found. Showing PDFs in Zotero PDFs. Update Bridge to save titles and import dates.';
  }
  const files = app.vault.getFiles();
  const entries = files.filter((file) => file.extension.toLowerCase() === 'pdf' &&
    (metadata.has(file.path) || file.path.startsWith('Zotero PDFs/')))
    .map((file) => entryFrom(file, metadata.get(file.path)));
  const byPath = new Map(entries.map((entry) => [entry.file.path, entry]));
  const shortcuts = files.filter((file) => file.extension.toLowerCase() === EXTENSION);
  let invalid = 0;
  for (const shortcut of shortcuts) {
    try {
      const target = await resolveShortcut(shortcut, {
        read: (file) => app.vault.read(file),
        getFile: (targetPath) => {
          const file = app.vault.getAbstractFileByPath(targetPath);
          return file instanceof TFile ? file : null;
        },
      });
      byPath.get(target.path)?.shortcuts.push(shortcut.path);
    } catch { invalid++; }
  }
  if (invalid) warning += ` ${invalid} unreadable or broken shortcut(s) could not be indexed.`;
  return { entries, warning: warning.trim() };
}
