#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const [targetDir, ...jestArgs] = process.argv.slice(2);

if (!targetDir) {
    console.error(
        'Usage: node tools/testing/run-web-esm-lib-tests.mjs <directory> [jest args...]'
    );
    process.exit(1);
}

const workspaceRoot = process.cwd();
const absoluteTargetDir = path.resolve(workspaceRoot, targetDir);

function collectSpecFiles(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const specFiles = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            specFiles.push(...collectSpecFiles(fullPath));
            continue;
        }

        if (
            entry.isFile() &&
            (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.test.ts'))
        ) {
            specFiles.push(fullPath);
        }
    }

    return specFiles;
}

const specFiles = collectSpecFiles(absoluteTargetDir).sort();

if (specFiles.length === 0) {
    console.error(`No spec files found under ${targetDir}`);
    process.exit(1);
}

const jestBin = path.resolve(workspaceRoot, 'node_modules/jest/bin/jest.js');
const jestConfig = path.resolve(
    workspaceRoot,
    'jest.web-esm.workspace.ts'
);

const result = spawnSync(
    process.execPath,
    [jestBin, '--config', jestConfig, '--runTestsByPath', ...specFiles, ...jestArgs],
    {
        env: process.env,
        stdio: 'inherit',
    }
);

process.exit(result.status ?? 1);
