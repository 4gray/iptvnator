/**
 * Runs one of content-title-fts-scenarios.ts on better-sqlite3, the module
 * the app ships. Run under Electron as Node (better-sqlite3 is built for
 * Electron's ABI) by content-title-fts.spec.ts, through
 * run-electron-harness.ts:
 *
 *   electron --import tsx content-title-fts-scenarios-cli.ts <scenario> <dir>
 *
 * Prints `verified` on success.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { contentTitleFtsScenarios } from './content-title-fts-scenarios';

const [scenario, dir] = process.argv.slice(2);
const run = contentTitleFtsScenarios[scenario];
assert(run, `Unknown scenario: ${scenario}`);
run(() => {
    const sqlite = new Database(join(dir, 'fts.db'));
    sqlite.pragma('journal_mode = WAL');
    return sqlite;
});
process.stdout.write('verified');
