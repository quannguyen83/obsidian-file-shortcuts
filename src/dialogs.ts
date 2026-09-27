import { App, FuzzySuggestModal, Modal, Setting, TFile, TFolder, type ButtonComponent } from 'obsidian';
import { shortcutName } from './shortcut';

export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly choose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder('Choose the file to open');
  }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
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
  private busy = false;

  constructor(
    app: App,
    private readonly target: TFile,
    private folder: TFolder,
    private readonly create: (path: string, folder: TFolder) => Promise<void>,
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
    const preview = this.contentEl.createEl('p', { cls: 'file-shortcuts-target' });
    const updatePreview = () => { preview.setText(`Filename: ${this.name.replace(/\.obslink$/i, '')}.obslink`); };
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
        const path = this.folder.isRoot() ? filename : `${this.folder.path}/${filename}`;
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('A file with this name already exists. Choose another name or folder.');
        this.busy = true;
        createButton.setDisabled(true);
        await this.create(path, this.folder);
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
