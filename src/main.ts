import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { PdfBrowser } from './pdf-browser';
import { suggestedName, readPdfMetadata } from './pdf-catalog';
import { CreateShortcutModal, FilePicker } from './dialogs';
import { EXTENSION, VIEW_TYPE, movedTarget, parseShortcut, resolveShortcut, serializeShortcut } from './shortcut';
import { ShortcutView } from './shortcut-view';

export default class FileShortcutsPlugin extends Plugin {
  private lastFolder = '/';
  private renameQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    const saved = await this.loadData() as { lastFolder?: unknown } | null;
    if (typeof saved?.lastFolder === 'string') this.lastFolder = saved.lastFolder;
    this.registerView(VIEW_TYPE, (leaf) => new ShortcutView(leaf, {
      resolve: (file) => this.resolve(file),
      repair: (file, onRepaired) => this.repair(file, onRepaired),
    }));
    this.registerExtensions([EXTENSION], VIEW_TYPE);

    const browsePdfs = () => new PdfBrowser(this.app, (file, title, done) => this.createFor(file, undefined, title, done)).open();
    this.addRibbonIcon('library', 'Browse imported PDFs', browsePdfs);
    this.addCommand({ id: 'browse-imported-pdfs', name: 'Browse imported PDFs', callback: browsePdfs });


    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile) {
        if (file.extension.toLowerCase() !== EXTENSION) menu.addItem((item) => item.setTitle('Create shortcut…').setIcon('file-symlink')
          .onClick(() => { void this.createFor(file); }));
        if (file.extension.toLowerCase() === EXTENSION) {
          menu.addItem((item) => item.setTitle('Change shortcut target…').setIcon('file-pen-line')
            .onClick(() => this.repair(file)));
        }
      } else if (file instanceof TFolder) {
        menu.addItem((item) => item.setTitle('Create shortcut here…').setIcon('file-symlink')
          .onClick(() => this.pickTarget(file)));
      }
    }));

    this.addCommand({
      id: 'create-shortcut', name: 'Create shortcut to current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension.toLowerCase() === EXTENSION) return false;
        if (!checking) void this.createFor(file);
        return true;
      },
    });
    this.addCommand({ id: 'choose-file-for-shortcut', name: 'Choose a file and create shortcut', callback: () => this.pickTarget() });

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      // Snapshot now: another rename can mutate the same TFile before this queue runs.
      const newPath = file.path;
      const folder = file instanceof TFolder;
      if (folder && (this.lastFolder === oldPath || this.lastFolder.startsWith(`${oldPath}/`))) {
        this.lastFolder = movedTarget(this.lastFolder, oldPath, newPath, true);
        void this.saveData({ lastFolder: this.lastFolder }).catch((error) => console.error('[file-shortcuts] Failed to save folder preference', error));
      }
      this.renameQueue = this.renameQueue.then(() => this.updateTargets(oldPath, newPath, folder))
        .catch((error: unknown) => {
          console.error('[file-shortcuts] Could not update shortcut targets', error);
          new Notice('Some shortcut targets could not be updated. Use Change shortcut target to repair them.');
        });
    }));
  }

  private async resolve(file: TFile): Promise<TFile> {
    await this.renameQueue;
    return resolveShortcut(file, {
      read: (entry) => this.app.vault.read(entry),
      getFile: (path) => {
        const entry = this.app.vault.getAbstractFileByPath(path);
        return entry instanceof TFile ? entry : null;
      },
    });
  }

  private pickTarget(folder?: TFolder): void {
    const picker = new FilePicker(this.app, (file, title) => { void this.createFor(file, folder, title); });
    void picker.prepare().then(() => picker.open());
  }

  private async createFor(file: TFile, folder?: TFolder, title?: string, done?: () => void): Promise<void> {
    try {
      if (file.extension.toLowerCase() === EXTENSION) throw new Error('Choose an original file, not a shortcut.');
      const target = await this.resolve(file);
      if (!title) {
        try { title = (await readPdfMetadata(this.app)).metadata.get(target.path)?.title; }
        catch { /* General file shortcuts still work without Bridge metadata. */ }
      }
      const previous = this.app.vault.getAbstractFileByPath(this.lastFolder);
      const destination = folder ?? (previous instanceof TFolder ? previous : this.app.vault.getRoot());
      new CreateShortcutModal(this.app, target, destination, async (path, selectedFolder, containerPath) => {
        if (this.app.vault.getAbstractFileByPath(target.path) !== target) throw new Error('The target file no longer exists.');
        if (containerPath) await this.app.vault.createFolder(containerPath);
        await this.app.vault.create(path, serializeShortcut(target.path));
        this.lastFolder = selectedFolder.path;
        // A failed preference save must not misreport a successfully created shortcut.
        try { await this.saveData({ lastFolder: this.lastFolder }); }
        catch (error) { console.error('[file-shortcuts] Failed to save folder preference', error); }
        new Notice(`Shortcut created: ${path}`);
        done?.();
      }, title ? suggestedName(title) : undefined).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : 'Could not create shortcut.');
    }
  }

  private repair(shortcut: TFile, onRepaired?: () => void): void {
    const picker = new FilePicker(this.app, (chosen) => {
      void (async () => {
        try {
          const target = await this.resolve(chosen);
          if (target === shortcut) throw new Error('A shortcut cannot point to itself.');
          await this.app.vault.modify(shortcut, serializeShortcut(target.path));
          new Notice('Shortcut target updated.');
          onRepaired?.();
        } catch (error) { new Notice(error instanceof Error ? error.message : 'Could not update shortcut.'); }
      })();
    });
    void picker.prepare().then(() => picker.open());
  }

  private async updateTargets(oldPath: string, newPath: string, folder: boolean): Promise<void> {
    let failed = false;
    for (const shortcut of this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() === EXTENSION)) {
      try {
        const content = await this.app.vault.read(shortcut);
        let target: string;
        try { target = parseShortcut(content).target; } catch { continue; }
        if (movedTarget(target, oldPath, newPath, folder) === target) continue;
        // Re-read under Vault.process so concurrent edits are not overwritten.
        await this.app.vault.process(shortcut, (latest) => {
          try {
            const data = parseShortcut(latest);
            const moved = movedTarget(data.target, oldPath, newPath, folder);
            return moved === data.target ? latest : serializeShortcut(moved);
          } catch { return latest; }
        });
      } catch (error) {
        failed = true;
        console.error('[file-shortcuts] Failed to update', shortcut.path, error);
      }
    }
    if (failed) throw new Error('One or more shortcuts could not be updated.');
  }
}
