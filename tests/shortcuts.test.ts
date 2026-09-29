import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EXTENSION, VIEW_TYPE, movedTarget, parseShortcut, resolveShortcut, serializeShortcut, shortcutName } from '../src/shortcut';
import { ShortcutView } from '../src/shortcut-view';
import FileShortcutsPlugin from '../src/main';
import { Modal, FuzzySuggestModal, Setting, TFile, TFolder } from './obsidian-mock';

(globalThis as any).window = globalThis;

function fixture() {
  const files = new Map<string, TFile | TFolder>();
  const handlers: Record<string, (...args: any[]) => void> = {};
  const root = new TFolder('/'); files.set('/', root);
  const add = (path: string, content = '') => { const f = new TFile(path, content); files.set(path, f); return f; };
  const folder = (path: string) => { const f = new TFolder(path); files.set(path, f); return f; };
  const writes: string[] = [];
  const vault = {
    getFile: (path: string) => { const f = files.get(path); return f instanceof TFile ? f : null; },
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getFiles: () => [...files.values()].filter((f): f is TFile => f instanceof TFile),
    getAllLoadedFiles: () => [...files.values()],
    getRoot: () => root,
    read: async (f: TFile) => f.content,
    create: async (path: string, content: string) => {
      if (files.has(path)) throw new Error('Already exists');
      writes.push(path); return add(path, content);
    },
    createFolder: async (path: string) => {
      if (files.has(path)) throw new Error('Already exists');
      return folder(path);
    },
    modify: async (f: TFile, content: string) => { writes.push(f.path); f.content = content; },
    process: async (f: TFile, fn: (content: string) => string) => { writes.push(f.path); f.content = fn(f.content); },
    on: (event: string, handler: any) => { handlers[event] = handler; return {}; },
  };
  const app = { vault, workspace: { getActiveFile: () => null, on: (event: string, handler: any) => { handlers[event] = handler; return {}; } } };
  const rename = (file: TFile | TFolder, path: string) => {
    const oldPath = file.path;
    for (const f of [...files.values()]) {
      if (f === file || (file instanceof TFolder && f.path.startsWith(`${oldPath}/`))) {
        files.delete(f.path); f.path = path + f.path.slice(oldPath.length); files.set(f.path, f);
      }
    }
    handlers.rename?.(file, oldPath);
  };
  return { add, folder, files, vault, app, writes, rename, handlers };
}

test('shortcut stores a portable vault path with Unicode and spaces', () => {
  assert.deepEqual(parseShortcut(serializeShortcut('Zotero PDFs/Bài báo #1.pdf')), { version: 1, target: 'Zotero PDFs/Bài báo #1.pdf' });
  assert.equal(shortcutName('KLT khi ảnh bị mờ'), 'KLT khi ảnh bị mờ.obslink');
  assert.equal(shortcutName('Paper.obslink'), 'Paper.obslink');
});

test('invalid versions, malformed JSON and paths outside the vault are rejected', () => {
  for (const raw of ['', 'null', '{}', '{"version":2,"target":"a.pdf"}']) assert.throws(() => parseShortcut(raw));
  for (const target of ['../a.pdf', '/a.pdf', 'C:\\a.pdf', 'https://example.com/a.pdf', 'a/../b.pdf', 'a//b.pdf', 'a\u0000.pdf']) {
    assert.throws(() => serializeShortcut(target));
  }
  for (const name of ['', '../paper', 'CON', 'NUL.pdf', 'a/b', 'a\\b', 'paper.', '.hidden']) assert.throws(() => shortcutName(name));
});

test('moving or renaming the shortcut still resolves to the identical original TFile', async () => {
  const f = fixture();
  const pdf = f.add('Zotero PDFs/A.pdf', 'original PDF bytes');
  const link = f.add('Papers/Friendly title.obslink', serializeShortcut(pdf.path));
  assert.equal(await resolveShortcut(link, f.vault), pdf);
  f.rename(link, 'Thesis/Another title.obslink');
  assert.equal(await resolveShortcut(link, f.vault), pdf);
  assert.equal(pdf.content, 'original PDF bytes');
  assert.deepEqual(f.writes, []);
});

test('chains resolve and cycles or missing targets produce errors', async () => {
  const f = fixture();
  const pdf = f.add('original.pdf');
  const b = f.add('b.obslink', serializeShortcut(pdf.path));
  const a = f.add('a.obslink', serializeShortcut(b.path));
  assert.equal(await resolveShortcut(a, f.vault), pdf);
  b.content = serializeShortcut(a.path);
  await assert.rejects(resolveShortcut(a, f.vault), /loop/);
  b.content = serializeShortcut('gone.pdf');
  await assert.rejects(resolveShortcut(a, f.vault), /Target file not found: gone.pdf/);
});

test('folder path replacement respects path segment boundaries', () => {
  assert.equal(movedTarget('PDF/A.pdf', 'PDF', 'Archive', true), 'Archive/A.pdf');
  assert.equal(movedTarget('PDFs/A.pdf', 'PDF', 'Archive', true), 'PDFs/A.pdf');
  assert.equal(movedTarget('PDF/A.pdf', 'PDF', 'Archive', false), 'PDF/A.pdf');
});

test('registered extension opens the original TFile on the same leaf after FileView finishes', async () => {
  const f = fixture();
  const plugin = new FileShortcutsPlugin() as any;
  plugin.app = f.app; await plugin.onload();
  assert.deepEqual(plugin.extensions, [{ extensions: [EXTENSION], type: VIEW_TYPE }]);
  const pdf = f.add('Zotero PDFs/KEY.pdf');
  const shortcut = f.add('Papers/Readable.obslink', serializeShortcut(pdf.path));
  const opened: TFile[] = [];
  const leaf: any = { openFile: async (file: TFile) => { opened.push(file); } };
  const view = plugin.views[VIEW_TYPE](leaf); leaf.view = view; view.file = shortcut;
  await view.onLoadFile(shortcut);
  assert.deepEqual(opened, [], 'opening must wait until the current view finishes loading');
  await delay(10);
  assert.deepEqual(opened, [pdf]);
  assert.deepEqual(f.writes, []);
});

test('a slow read cannot redirect a tab after the user has navigated away', async () => {
  const f = fixture();
  const pdf = f.add('file.pdf'); const shortcut = f.add('shortcut.obslink');
  let complete!: (value: any) => void;
  const opened: any[] = [];
  const leaf: any = { openFile: async (file: any) => { opened.push(file); } };
  const view = new ShortcutView(leaf, { resolve: () => new Promise((resolve) => { complete = resolve; }), repair() {} }) as any;
  leaf.view = view; view.file = shortcut;
  const loading = view.onLoadFile(shortcut);
  await view.onUnloadFile();
  leaf.view = {};
  complete(pdf); await loading; await delay(10);
  assert.deepEqual(opened, []);
});

test('unloading cancels an already scheduled redirect', async () => {
  const f = fixture(); const pdf = f.add('file.pdf'); const link = f.add('shortcut.obslink');
  const opened: any[] = [];
  const leaf: any = { openFile: async (file: any) => { opened.push(file); } };
  const view = new ShortcutView(leaf, { resolve: async () => pdf as any, repair() {} }) as any;
  leaf.view = view; view.file = link; await view.onLoadFile(link); view.onunload();
  await delay(10); assert.deepEqual(opened, []);
});

test('missing target shows retry and repair controls without creating any file', async () => {
  const f = fixture(); const link = f.add('shortcut.obslink', serializeShortcut('gone.pdf'));
  let repairFile: any;
  const leaf: any = { openFile: async () => { assert.fail('Must not open a missing file'); } };
  const view = new ShortcutView(leaf, { resolve: (file) => resolveShortcut(file as any, f.vault) as any, repair: (file) => { repairFile = file; } }) as any;
  leaf.view = view; view.file = link; await view.onLoadFile(link);
  assert.match(view.contentEl.children[1].text, /Target file not found/);
  view.contentEl.children.find((el: any) => el.text === 'Choose target file').events.click();
  assert.equal(repairFile, link);
  assert.deepEqual(f.writes, []);
});

test('rapid target and folder renames update shortcuts, never target contents', async () => {
  const f = fixture(); const folder = f.folder('Zotero PDFs');
  const pdf = f.add('Zotero PDFs/A.pdf', 'PDF bytes');
  const unrelated = f.add('Zotero PDFs Extra/B.pdf', 'other bytes');
  const link = f.add('Thesis/Paper.obslink', serializeShortcut(pdf.path));
  const other = f.add('Thesis/Other.obslink', serializeShortcut(unrelated.path));
  const plugin = new FileShortcutsPlugin() as any; plugin.app = f.app; await plugin.onload();
  f.rename(pdf, 'Zotero PDFs/B.pdf'); f.rename(pdf, 'Zotero PDFs/C.pdf'); f.rename(folder, 'Archive');
  await plugin.renameQueue;
  assert.equal(parseShortcut(link.content).target, 'Archive/C.pdf');
  assert.equal(parseShortcut(other.content).target, unrelated.path);
  assert.equal(await plugin.resolve(link), pdf);
  assert.equal(pdf.content, 'PDF bytes');
  assert.ok(f.writes.every((path) => path === link.path));
});

test('context menu creates a named shortcut in a chosen folder; collisions never overwrite', async () => {
  const f = fixture(); const folder = f.folder('Thesis');
  const pdf = f.add('Zotero PDFs/A.pdf', 'PDF bytes');
  const plugin = new FileShortcutsPlugin() as any; plugin.app = f.app; await plugin.onload();
  let click!: () => void;
  const item: any = { setTitle() { return this; }, setIcon() { return this; }, onClick(cb: () => void) { click = cb; return this; } };
  f.handlers['file-menu']({ addItem: (fn: any) => fn(item) }, folder);
  click(); await delay(0); FuzzySuggestModal.picker.onChooseItem(pdf); await delay(0);
  const name = Setting.controls.findLast((s) => s.name === 'Shortcut name')!.texts[0];
  name.callback('KLT paper');
  const create = Setting.controls.flatMap((s) => s.buttons).findLast((b) => b.text === 'Create shortcut')!;
  await create.callback();
  const link = f.vault.getFile('Thesis/KLT paper.obslink')!;
  assert.equal(parseShortcut(link.content).target, pdf.path);
  assert.deepEqual(f.writes, ['Thesis/KLT paper.obslink']);
  // Repeat with the same chosen name: UI shows an error, original shortcut is untouched.
  click(); await delay(0); FuzzySuggestModal.picker.onChooseItem(pdf); await delay(0);
  Setting.controls.findLast((s) => s.name === 'Shortcut name')!.texts[0].callback('KLT paper');
  await Setting.controls.flatMap((s) => s.buttons).findLast((b) => b.text === 'Create shortcut')!.callback();
  assert.ok(Modal.last.contentEl.children.some((el) => /already exists/.test(el.text)));
  assert.deepEqual(f.writes, ['Thesis/KLT paper.obslink']);
  f.files.delete(link.path);
  assert.equal(f.vault.getFile(pdf.path), pdf);
  assert.equal(pdf.content, 'PDF bytes');
});


test('folder mode creates a paper folder containing the shortcut file', async () => {
  const f = fixture(); const folder = f.folder('Papers');
  const pdf = f.add('Zotero PDFs/A.pdf', 'PDF bytes');
  const plugin = new FileShortcutsPlugin() as any; plugin.app = f.app; await plugin.onload();
  await plugin.createFor(pdf, folder, 'Readable Paper');
  const layout = Setting.controls.findLast((s) => s.name === 'Create as')!.texts[0];
  layout.callback('folder');
  const name = Setting.controls.findLast((s) => s.name === 'Shortcut name')!.texts[0];
  name.callback('Readable Paper');
  await Setting.controls.flatMap((s) => s.buttons).findLast((b) => b.text === 'Create shortcut')!.callback();
  const link = f.vault.getFile('Papers/Readable Paper/PDF.obslink')!;
  assert.ok(f.files.get('Papers/Readable Paper') instanceof TFolder);
  assert.equal(parseShortcut(link.content).target, pdf.path);
  assert.deepEqual(f.writes, ['Papers/Readable Paper/PDF.obslink']);
});


test('PDF catalog keeps import dates exact, legacy dates approximate, and finds existing shortcuts', async () => {
  const { loadPdfCatalog, selectEntries, suggestedName } = await import('../src/pdf-catalog');
  const f = fixture();
  const now = Date.now();
  const pdf = f.add('Zotero PDFs/A.pdf'); pdf.stat.ctime = now - 86400000;
  const old = f.add('Zotero PDFs/B.pdf'); old.stat.ctime = now - 30 * 86400000; old.stat.mtime = now;
  f.add('Thesis/Tracking.obslink', serializeShortcut(pdf.path));
  f.add('Thesis/Copy.obslink', serializeShortcut('Thesis/Tracking.obslink'));
  f.add('Thesis/Broken.obslink', 'invalid JSON');
  const mapping = { pdfs: { [pdf.path]: { title: 'Motion blur and KLT', attachmentKey: 'A', importedAt: new Date(now).toISOString() }, [old.path]: { title: 'Older odometry paper', attachmentKey: 'B' } } };
  Object.assign(f.vault, { configDir: '.custom', adapter: { exists: async (path: string) => path.startsWith('.custom/'), read: async () => JSON.stringify(mapping) } });
  const catalog = await loadPdfCatalog(f.app as any);
  assert.equal(catalog.entries.length, 2);
  const newest = selectEntries(catalog.entries, '', 'all', now)[0];
  assert.equal(newest.title, 'Motion blur and KLT'); assert.equal(newest.dateSource, 'import');
  assert.deepEqual(newest.shortcuts, ['Thesis/Tracking.obslink', 'Thesis/Copy.obslink']);
  assert.deepEqual(selectEntries(catalog.entries, '', 'unlinked', now).map(e => e.file), [old]);
  assert.deepEqual(selectEntries(catalog.entries, '', 'recent', now).map(e => e.file), [pdf]);
  assert.equal(selectEntries(catalog.entries, 'KLT motion', 'all', now).length, 1);
  assert.equal(selectEntries(catalog.entries, 'B.pdf', 'all', now)[0].dateSource, 'created');
  assert.match(catalog.warning, /broken shortcut/);
  assert.equal(suggestedName('KLT: why / blur?'), 'KLT why blur');
  assert.equal(suggestedName('CON'), 'Paper CON');
  assert.deepEqual(f.writes, []);
});

test('PDF browser search and create action pass the readable title and original TFile', async () => {
  const { PdfBrowser } = await import('../src/pdf-browser');
  const f = fixture(); const pdf = f.add('Zotero PDFs/KEY.pdf');
  Object.assign(f.vault, { configDir: '.obsidian', adapter: { exists: async () => true, read: async () => JSON.stringify({pdfs:{[pdf.path]:{title:'Tracking through blur',attachmentKey:'KEY'}}}) } });
  const selections: any[] = [];
  const browser = new PdfBrowser(f.app as any, async (file, title) => { selections.push({ file, title }); });
  browser.open(); await delay(0);
  const search = Setting.controls.findLast(s => s.name === 'Search')!.texts[0];
  search.callback('Tracking');
  await Setting.controls.flatMap(s => s.buttons).findLast(b => b.text === 'Create shortcut')!.callback();
  assert.deepEqual(selections, [{file: pdf, title:'Tracking through blur'}]);
  browser.close();
});

test('right-click file picker excludes shortcuts and sorts by import/creation date with readable titles', async () => {
  const { FilePicker } = await import('../src/dialogs');
  const f = fixture();
  const old = f.add('Zotero PDFs/OLD.pdf'); old.stat.ctime = 10;
  const imported = f.add('Zotero PDFs/KEY.pdf'); imported.stat.ctime = 5;
  const recent = f.add('Notes/New.md'); recent.stat.ctime = 20;
  const shortcut = f.add('Readable.OBSLINK'); shortcut.stat.ctime = 999;
  Object.assign(f.vault, {configDir:'.obsidian',adapter:{exists:async()=>true,read:async()=>JSON.stringify({pdfs:{[imported.path]:{title:'Paper about KLT',importedAt:new Date(100).toISOString()}}})}});
  const selected: any[] = [];
  const picker = new FilePicker(f.app as any, (file,title)=>selected.push({file,title}));
  await picker.prepare();
  assert.deepEqual(picker.getItems(),[imported,recent,old]);
  assert.match(picker.getItemText(imported as any),/Paper about KLT/);
  picker.onChooseItem(shortcut as any); assert.equal(selected.length,0);
  picker.onChooseItem(imported as any); assert.deepEqual(selected,[{file:imported,title:'Paper about KLT'}]);
});

test('shortcut files offer repair only and cannot use create-shortcut command', async () => {
  const f = fixture(); const shortcut = f.add('Paper.obslink',serializeShortcut('a.pdf'));
  f.app.workspace.getActiveFile = () => shortcut as any;
  const plugin = new FileShortcutsPlugin() as any; plugin.app=f.app; await plugin.onload();
  const titles: string[] = [];
  f.handlers['file-menu']({addItem:(fn:any)=>{const item:any={setTitle:(title:string)=>{titles.push(title);return item;},setIcon:()=>item,onClick:()=>item};fn(item);}},shortcut);
  assert.deepEqual(titles,['Change shortcut target…']);
  assert.equal(plugin.commands.find((c:any)=>c.id==='create-shortcut').checkCallback(true),false);
  await plugin.createFor(shortcut);
  assert.deepEqual(f.writes,[]);
});
