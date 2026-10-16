#!/usr/bin/env node

// Downloads the Electron binary once and proves it runs, before anything
// spawns it concurrently.
//
// pnpm does not run Electron's postinstall (it is not in
// `onlyBuiltDependencies`), so `pnpm install` leaves no binary behind and
// `require('electron')` downloads and extracts it on first use. Unit specs
// that execute SQLite code under `ELECTRON_RUN_AS_NODE` resolve it that way,
// and Tier A projects and Jest workers run in parallel: one process can exec
// the binary while another is still extracting it (ETXTBSY on Linux, clobbered
// framework symlinks on macOS). Running this first leaves nothing to download.
//
// Usage: node tools/testing/ensure-electron-binary.mjs

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { version } = require('electron/package.json');

let electronPath;
try {
    electronPath = require('electron');
} catch (error) {
    console.error(
        `Electron ${version} binary download failed: ${error.message}`
    );
    process.exit(1);
}

let reported;
try {
    reported = execFileSync(
        electronPath,
        ['-e', 'process.stdout.write(process.versions.electron)'],
        {
            encoding: 'utf8',
            // The child's stderr (e.g. a dyld or loader error) goes straight
            // to the log instead of being repeated in the message below.
            stdio: ['ignore', 'pipe', 'inherit'],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            timeout: 60_000,
        }
    ).trim();
} catch (error) {
    console.error(
        `Electron binary at ${electronPath} does not run (${error.code ?? `exit ${error.status}`}). ` +
            'If an interrupted download left a partial copy, delete node_modules/electron/dist and path.txt, then rerun.'
    );
    process.exit(1);
}

if (reported !== version) {
    console.error(
        `Electron binary at ${electronPath} reports ${reported || 'no version'}, expected ${version}.`
    );
    process.exit(1);
}

console.log(`Electron ${version} binary ready at ${electronPath}`);
