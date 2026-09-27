import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { loadPdfCatalog, selectEntries, type CatalogFilter, type PdfEntry } from './pdf-catalog';

type BridgeApi = { refreshImportedPdfMetadata(): Promise<{ updated: number; unmatched: number }> };
// Optional integration; the general shortcut functionality has no Bridge dependency.
type WithPlugins = App & { plugins?: { getPlugin(id: string): Partial<BridgeApi> | undefined } };

export class PdfBrowser extends Modal {
  private entries: PdfEntry[] = [];
  private search = '';
  private filter: CatalogFilter = 'all';
  private status!: HTMLElement;
  private results!: HTMLElement;
  private generation = 0;
  private limit = 50;

  constructor(app: App, private readonly create: (file: TFile, title: string, done: () => void) => Promise<void>) { super(app); }

  onOpen(): void {
    this.modalEl.addClass('file-shortcuts-browser');
    this.setTitle('Imported PDFs');
    this.contentEl.createEl('p', { text: 'Find a paper, open its PDF, or create a shortcut. Newest files appear first.', cls: 'file-shortcuts-target' });
    new Setting(this.contentEl).setName('Search').addSearch((input) => input
      .setPlaceholder('Paper title, attachment key, or path…')
      .onChange((value) => { this.search = value; this.limit = 50; this.render(); }));
    new Setting(this.contentEl).setName('Show').addDropdown((dropdown) => dropdown
      .addOption('all', 'All imported PDFs')
      .addOption('recent', 'Recent — last 7 days')
      .addOption('unlinked', 'Without a shortcut')
      .onChange((value) => { this.filter = value as CatalogFilter; this.limit = 50; this.render(); }))
      .addButton((button) => button.setButtonText('Reload list').onClick(() => { void this.reload(); }))
      .addButton((button) => button.setButtonText('Refresh titles from Zotero').onClick(async () => {
        const bridge = (this.app as WithPlugins).plugins?.getPlugin('obsidian-zotero-bridge');
        if (!bridge?.refreshImportedPdfMetadata) {
          new Notice('Enable Zotero Bridge 0.1.19 or newer to refresh titles.');
          return;
        }
        button.setDisabled(true);
        try {
          const result = await bridge.refreshImportedPdfMetadata();
          new Notice(`Updated ${result.updated} titles; ${result.unmatched} not found or ambiguous.`);
          if (this.results.isConnected) await this.reload();
        } catch {
          new Notice('Could not refresh titles. Open Zotero with Companion enabled and try again. Cached titles are still available.');
        } finally { button.setDisabled(false); }
      }));
    this.status = this.contentEl.createEl('p', { cls: 'file-shortcuts-target', attr: { role: 'status' } });
    this.results = this.contentEl.createDiv({ cls: 'file-shortcuts-results' });
    void this.reload();
  }

  private async reload(): Promise<void> {
    const generation = ++this.generation;
    this.status.setText('Loading imported PDFs…');
    try {
      const catalog = await loadPdfCatalog(this.app);
      if (generation !== this.generation) return;
      this.entries = catalog.entries;
      this.status.setText(catalog.warning || 'Older files use file creation time (approximate). Refresh titles once to identify existing imports.');
      this.render();
    } catch (error) {
      if (generation === this.generation) this.status.setText(`Could not load PDFs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private render(): void {
    if (!this.results) return;
    this.results.empty();
    const selected = selectEntries(this.entries, this.search, this.filter);
    this.results.createEl('p', { text: `${selected.length} of ${this.entries.length} PDFs`, cls: 'file-shortcuts-target' });
    if (!selected.length) this.results.createEl('p', { text: 'No matching PDFs. Try All imported PDFs or clear the search.' });
    for (const entry of selected.slice(0, this.limit)) {
      const card = this.results.createDiv({ cls: 'file-shortcuts-pdf-card' });
      card.createEl('h3', { text: entry.title });
      card.createEl('p', { text: entry.file.path, cls: 'file-shortcuts-target' });
      const when = entry.timestamp > 0 ? new Date(entry.timestamp).toLocaleString() : 'Unknown';
      card.createEl('p', { text: `${entry.dateSource === 'import' ? 'Imported' : entry.dateSource === 'created' ? 'File created (approximate)' : 'Date'}: ${when}` });
      card.createEl('p', { text: entry.shortcuts.length ? `Shortcuts: ${entry.shortcuts.join(' · ')}` : 'No shortcut yet', cls: 'file-shortcuts-target' });
      new Setting(card)
        .addButton((button) => button.setButtonText('Open PDF').onClick(async () => {
          try { await this.app.workspace.getLeaf('tab').openFile(entry.file); this.close(); }
          catch { new Notice('Could not open the PDF. Reload the list to check whether it still exists.'); }
        }))
        .addButton((button) => button.setButtonText('Create shortcut').setCta().onClick(() =>
          this.create(entry.file, entry.title, () => { if (this.results.isConnected) void this.reload(); })));
    }
    if (selected.length > this.limit) new Setting(this.results).addButton((button) => button
      .setButtonText('Show more').onClick(() => { this.limit += 50; this.render(); }));
  }

  onClose(): void { this.generation++; this.contentEl.empty(); }
}
