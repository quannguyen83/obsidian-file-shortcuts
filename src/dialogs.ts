import { App, FuzzySuggestModal, Modal, Setting, TFile, TFolder, type ButtonComponent, type FuzzyMatch } from 'obsidian';
import { entryFrom, readPdfMetadata, type Metadata } from './pdf-catalog';
import { EXTENSION, shortcutName } from './shortcut';

export class FilePicker extends FuzzySuggestModal<TFile> {
  private metadata = new Map<string, Metadata>();
  constructor(app: App, private readonly choose: (file: TFile, title?: string) => void) {
    super(app);
    this.setPlaceholder('Search title or path — newest imports / files first');
  }
  async prepare(): Promise<this> {
    try { this.metadata = (await readPdfMetadata(this.app)).metadata; }
    catch { this.metadata.clear(); }
    return this;
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => file.extension.toLowerCase() !== EXTENSION)
      .sort((a, b) => entryFrom(b, this.metadata.get(b.path)).timestamp - entryFrom(a, this.metadata.get(a.path)).timestamp
        || this.getItemText(a).localeCompare(this.getItemText(b)));
  }
  getItemText(file: TFile): string {
    const title = this.metadata.get(file.path)?.title;
    return title ? `${title} — ${file.path}` : file.path;
  }
  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const entry = entryFrom(match.item, this.metadata.get(match.item.path));
    el.createDiv({ text: entry.title });
    const date = entry.timestamp > 0 ? new Date(entry.timestamp).toLocaleString() : 'Unknown';
    el.createDiv({ text: `${entry.file.path} · ${entry.dateSource === 'import' ? 'Imported' : 'File created (approximate)'}: ${date}`, cls: 'file-shortcuts-picker-detail' });
  }
  onChooseItem(file: TFile): void {
    if (file.extension.toLowerCase() === EXTENSION) return;
    this.choose(file, this.metadata.get(file.path)?.title);
  }
}

class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly choose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder('Choose a folder for the shortcut');
  }
  getItems(): TFolder[] {
    const root = this.app.vault.getRoot();
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && file !== root)
      .sort((a, b) => a.path.localeCompare(b.path));
    return [root, ...folders];
  }
  getItemText(folder: TFolder): string { return folder.isRoot() ? '/ (vault root)' : folder.path; }
  onChooseItem(folder: TFolder): void { this.choose(folder); }
}

export class CreateShortcutModal extends Modal {
  private name: string;
  private layout: 'file' | 'folder' = 'file';
  private busy = false;

  constructor(
    app: App,
    private readonly target: TFile,
    private folder: TFolder,
    private readonly create: (path: string, folder: TFolder, containerPath?: string) => Promise<void>,
    initialName?: string,
  ) {
    super(app);
    this.name = initialName ?? target.basename;
  }

  onOpen(): void {
    this.setTitle('Create shortcut');
    this.contentEl.createEl('p', { text: `Opens: ${this.target.path}`, cls: 'file-shortcuts-target' });
    const folderSetting = new Setting(this.contentEl).setName('Folder');
    const updateFolder = () => folderSetting.setDesc(this.folder.isRoot() ? '/ (vault root)' : this.folder.path);
    updateFolder();
    folderSetting.addButton((button) => button.setButtonText('Choose folder').onClick(() => {
      if (this.busy) return;
      new FolderPicker(this.app, (folder) => { this.folder = folder; updateFolder(); }).open();
    }));
    const layoutSetting = new Setting(this.contentEl).setName('Create as');
    layoutSetting.addDropdown((dropdown) => dropdown
      .addOption('file', 'Shortcut file only')
      .addOption('folder', 'Folder containing shortcut')
      .setValue(this.layout)
      .onChange((value) => { this.layout = value === 'folder' ? 'folder' : 'file'; updatePreview(); }));
    const preview = this.contentEl.createEl('p', { cls: 'file-shortcuts-target' });
    const updatePreview = () => {
      const stem = this.name.replace(/\.obslink$/i, '');
      const typeName = this.target.extension ? this.target.extension.toUpperCase() : 'FILE';
      preview.setText(this.layout === 'folder' ? `Creates: ${stem}/${typeName}.obslink` : `Creates: ${stem}.obslink`);
    };
    let nameInput: HTMLInputElement | undefined;
    new Setting(this.contentEl).setName('Shortcut name').addText((text) => {
      nameInput = text.inputEl;
      text.setValue(this.name).onChange((value) => { this.name = value; updatePreview(); });
      text.inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void submit(); }
      });
    });
    updatePreview();
    const errorEl = this.contentEl.createEl('p', { cls: 'file-shortcuts-error', attr: { role: 'alert' } });
    let createButton: ButtonComponent;
    const submit = async () => {
      if (this.busy) return;
      errorEl.empty();
      try {
        const filename = shortcutName(this.name);
        if (this.app.vault.getAbstractFileByPath(this.folder.path) !== this.folder) throw new Error('The selected folder no longer exists. Choose another folder.');
        const stem = filename.slice(0, -(EXTENSION.length + 1));
        const containerPath = this.layout === 'folder'
          ? (this.folder.isRoot() ? stem : `${this.folder.path}/${stem}`)
          : undefined;
        const typeName = this.target.extension ? this.target.extension.toUpperCase() : 'FILE';
        const path = containerPath
          ? `${containerPath}/${typeName}.${EXTENSION}`
          : (this.folder.isRoot() ? filename : `${this.folder.path}/${filename}`);
        if (containerPath && this.app.vault.getAbstractFileByPath(containerPath)) throw new Error('A folder or file with this name already exists. Choose another name or folder.');
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A file with this name already exists. Choose another name or folder.');
        this.busy = true;
        createButton.setDisabled(true);
        await this.create(path, this.folder, containerPath);
        this.close();
      } catch (error) {
        errorEl.setText(error instanceof Error ? error.message : 'Could not create shortcut.');
      } finally {
        this.busy = false;
        createButton.setDisabled(false);
      }
    };
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Cancel').onClick(() => { if (!this.busy) this.close(); }))
      .addButton((button) => { createButton = button; button.setButtonText('Create shortcut').setCta().onClick(submit); });
    nameInput?.focus();
    nameInput?.select();
  }

  onClose(): void { this.contentEl.empty(); }
}
