import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
await build({
  entryPoints: ['tests/shortcuts.test.ts'], bundle: true, platform: 'node', format: 'esm',
  target: 'node22', outfile: '.test-build/shortcuts.test.mjs',
  alias: { obsidian: resolve('tests/obsidian-mock.ts') },
});
const result = spawnSync(process.execPath, ['--test', '.test-build/shortcuts.test.mjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
