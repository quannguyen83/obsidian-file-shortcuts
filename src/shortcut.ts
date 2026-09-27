export const EXTENSION = 'obslink';
export const VIEW_TYPE = 'file-shortcut';

export interface Shortcut {
  version: 1;
  target: string;
}

/** Paths are relative to the vault root, never to the shortcut's folder. */
export function validateTarget(path: unknown): string {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\x00-\x1f:]/.test(path)) {
    throw new Error('The shortcut must point to a file inside this vault.');
  }
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('The shortcut contains an invalid vault path.');
  }
  return path;
}

export function parseShortcut(content: string): Shortcut {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('This shortcut is not valid JSON. Choose a target file to repair it.');
  }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('target' in value)) {
    throw new Error('This file is not a supported version 1 shortcut.');
  }
  return { version: 1, target: validateTarget(value.target) };
}

export function serializeShortcut(target: string): string {
  return JSON.stringify({ version: 1, target: validateTarget(target) }, null, 2) + '\n';
}

export function shortcutName(input: string): string {
  const name = input.trim().replace(/\.obslink$/i, '').trim();
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name.startsWith('.')) {
    throw new Error('Enter a filename without slashes or special characters.');
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('This filename is reserved on Windows. Please choose another name.');
  }
  if (name.length > 180) throw new Error('Please use a shorter shortcut name (180 characters or less).');
  return `${name}.${EXTENSION}`;
}

export function movedTarget(target: string, oldPath: string, newPath: string, folder: boolean): string {
  if (target === oldPath) return newPath;
  if (folder && target.startsWith(`${oldPath}/`)) return newPath + target.slice(oldPath.length);
  return target;
}

export interface FileRef { path: string; extension: string }
export interface ShortcutVault<F extends FileRef> {
  read(file: F): Promise<string>;
  getFile(path: string): F | null;
}

/** Resolve chains without ever presenting an alias PDF path to a viewer. */
export async function resolveShortcut<F extends FileRef>(file: F, vault: ShortcutVault<F>): Promise<F> {
  const visited = new Set<string>();
  let current = file;
  while (current.extension.toLowerCase() === EXTENSION) {
    if (visited.has(current.path)) throw new Error('These shortcuts form a loop. Choose a different target file.');
    if (visited.size >= 32) throw new Error('This shortcut chain is too long. Point it directly to the original file.');
    visited.add(current.path);
    const { target } = parseShortcut(await vault.read(current));
    const next = vault.getFile(target);
    if (!next) throw new Error(`Target file not found: ${target}`);
    current = next;
  }
  return current;
}
