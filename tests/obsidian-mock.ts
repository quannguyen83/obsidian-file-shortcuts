// Test double for public Obsidian APIs; does not emulate the desktop application.
export class Element {
  children: Element[] = [];
  isConnected = true;
  addClass(_name: string) {}
  createDiv(options: any = {}) { return this.createEl('div', options); }
  text = '';
  value = '';
  events: Record<string, (...args: any[]) => void> = {};
  empty() { this.children = []; this.text = ''; }
  createEl(_tag: string, options: any = {}) { const el = new Element(); el.text = options.text ?? ''; this.children.push(el); return el; }
  setText(text: string) { this.text = text; }
  addEventListener(name: string, cb: any) { this.events[name] = cb; }
  focus() {}
  select() {}
}
export class TFile {
  stat = { ctime: 1, mtime: 1 };
  constructor(public path: string, public content = '') {}
  get extension() { return this.path.split('.').pop() ?? ''; }
  get basename() { return this.path.split('/').pop()!.replace(/\.[^.]+$/, ''); }
}
export class TFolder {
  constructor(public path: string) {}
  isRoot() { return this.path === '/'; }
}
export class App {}
export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}
export class Plugin {
  app: any;
  saved: any = null;
  views: Record<string, any> = {};
  extensions: any[] = [];
  commands: any[] = [];
  async loadData() { return this.saved; }
  async saveData(data: any) { this.saved = data; }
  registerView(type: string, factory: any) { this.views[type] = factory; }
  registerExtensions(extensions: string[], type: string) { this.extensions.push({ extensions, type }); }
  registerEvent(_event: unknown) {}
  addRibbonIcon() {}
  addCommand(command: any) { this.commands.push(command); }
}
export class FileView {
  file: TFile | null = null;
  contentEl = new Element();
  constructor(public leaf: any) {}
  onunload() {}
}
export class Modal {
  static last: Modal;
  modalEl = new Element();
  contentEl = new Element();
  title = '';
  constructor(public app: any) {}
  setTitle(title: string) { this.title = title; }
  open() { Modal.last = this; this.onOpen(); }
  close() { this.onClose(); }
  onOpen() {}
  onClose() {}
}
export class FuzzySuggestModal<T> extends Modal {
  static picker: FuzzySuggestModal<any>;
  setPlaceholder(_text: string) {}
  open() { FuzzySuggestModal.picker = this; }
  onChooseItem(_item: T) {}
}
class Button {
  text = '';
  disabled = false;
  callback: () => any = () => {};
  setButtonText(text: string) { this.text = text; return this; }
  setCta() { return this; }
  setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
  onClick(callback: () => any) { this.callback = callback; return this; }
}
class Text {
  inputEl = new Element();
  callback: (value: string) => void = () => {};
  setPlaceholder(_value: string) { return this; }
  addOption(_key: string, _label: string) { return this; }
  setValue(value: string) { this.inputEl.value = value; return this; }
  onChange(callback: (value: string) => void) { this.callback = callback; return this; }
}
export class Setting {
  static controls: Setting[] = [];
  name = '';
  buttons: Button[] = [];
  texts: Text[] = [];
  constructor(_el: unknown) { Setting.controls.push(this); }
  setName(name: string) { this.name = name; return this; }
  setDesc(_desc: string) { return this; }
  addButton(callback: (button: Button) => void) { const b = new Button(); this.buttons.push(b); callback(b); return this; }
  addSearch(callback: (text: Text) => void) { return this.addText(callback); }
  addDropdown(callback: (text: Text) => void) { return this.addText(callback); }
  addText(callback: (text: Text) => void) { const t = new Text(); this.texts.push(t); callback(t); return this; }
}
