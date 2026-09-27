import { FileView, TFile, type WorkspaceLeaf } from 'obsidian';
import { EXTENSION, VIEW_TYPE } from './shortcut';

export interface ShortcutActions {
  resolve(file: TFile): Promise<TFile>;
  repair(file: TFile, onRepaired: () => void): void;
}

export class ShortcutView extends FileView {
  private generation = 0;
  private redirectTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly actions: ShortcutActions) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? 'File shortcut'; }
  getIcon(): string { return 'file-symlink'; }
  canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === EXTENSION; }

  private cancelRedirect(): void {
    this.generation++;
    if (this.redirectTimer !== null) window.clearTimeout(this.redirectTimer);
    this.redirectTimer = null;
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.cancelRedirect();
    const generation = this.generation;
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Opening original file…' });
    try {
      const target = await this.actions.resolve(file);
      if (generation !== this.generation || this.file !== file || this.leaf.view !== this) return;
      // Let FileView.setState finish before changing this leaf's view type.
      // Otherwise its pending state can overwrite the target viewer's state.
      this.redirectTimer = window.setTimeout(() => {
        this.redirectTimer = null;
        if (generation !== this.generation || this.file !== file || this.leaf.view !== this) return;
        // Opening the real TFile preserves viewer selection and Zotero/PDF mappings.
        void this.leaf.openFile(target).catch((error: unknown) => {
          if (this.leaf.view === this && generation === this.generation) this.showError(file, error);
        });
      }, 0);
    } catch (error) {
      if (generation === this.generation && this.file === file && this.leaf.view === this) this.showError(file, error);
    }
  }

  private showError(file: TFile, error: unknown): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Unable to open shortcut' });
    this.contentEl.createEl('p', { text: error instanceof Error ? error.message : 'Could not open the target file.' });
    const retry = this.contentEl.createEl('button', { text: 'Try again' });
    retry.addEventListener('click', () => { void this.onLoadFile(file); });
    const repair = this.contentEl.createEl('button', { text: 'Choose target file', cls: 'mod-cta file-shortcuts-repair' });
    repair.addEventListener('click', () => this.actions.repair(file, () => {
      if (this.file === file && this.leaf.view === this) void this.onLoadFile(file);
    }));
  }

  async onUnloadFile(): Promise<void> { this.cancelRedirect(); }
  onunload(): void { this.cancelRedirect(); super.onunload(); }
}
