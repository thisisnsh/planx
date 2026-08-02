#!/usr/bin/env node
// tsc does not preserve the executable bit, and npm only chmods bin entries at
// install time — so a locally built `node dist/cli.js` works but `./dist/cli.js`
// would not. Fix it right after the build.
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'dist', 'cli.js');

if (existsSync(cli)) {
  chmodSync(cli, 0o755);
}
