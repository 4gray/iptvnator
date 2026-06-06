#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

console.warn(
    'Experimental: browser V8 coverage for existing Playwright specs requires Chromium and is intended for local investigation, not CI gating.'
);

const workspaceRoot = process.cwd();

const result = spawnSync(
    'pnpm',
    [
        'nx',
        'run',
        'web-e2e:e2e',
        '--',
        '--project=chromium',
    ],
    {
        cwd: process.cwd(),
        env: {
            ...process.env,
            IPTVNATOR_E2E_V8_COVERAGE: '1',
        },
        stdio: 'inherit',
    }
);

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

function listFiles(directory, predicate) {
    if (!existsSync(directory)) {
        return [];
    }

    const files = [];
    for (const entry of readdirSync(directory)) {
        const fullPath = path.join(directory, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            files.push(...listFiles(fullPath, predicate));
        } else if (predicate(fullPath)) {
            files.push(fullPath);
        }
    }
    return files;
}

function mergeRanges(ranges) {
    const sorted = ranges
        .filter((range) => range.count > 0)
        .map((range) => [range.startOffset, range.endOffset])
        .sort(([leftStart], [rightStart]) => leftStart - rightStart);
    const merged = [];

    for (const [start, end] of sorted) {
        const previous = merged.at(-1);
        if (previous && start <= previous[1]) {
            previous[1] = Math.max(previous[1], end);
        } else {
            merged.push([start, end]);
        }
    }

    return merged;
}

function summarizeJsEntry(entry) {
    const sourceLength = entry.source?.length ?? 0;
    const ranges = mergeRanges((entry.functions ?? []).flatMap((fn) => fn.ranges ?? []));
    const usedBytes = ranges.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
    return {
        url: entry.url,
        sourceLength,
        usedBytes,
        pct: sourceLength > 0 ? Math.round((usedBytes / sourceLength) * 10000) / 100 : 0,
    };
}

const rawCoverageRoot = path.join(workspaceRoot, 'apps/web-e2e/test-results');
const rawFiles = listFiles(rawCoverageRoot, (file) =>
    file.endsWith('.json') && file.includes(`${path.sep}v8-coverage${path.sep}`)
);
const entriesByUrl = new Map();

for (const file of rawFiles) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    for (const entry of raw.js ?? []) {
        if (!entry.url || entry.url.startsWith('extensions::')) {
            continue;
        }
        const summary = summarizeJsEntry(entry);
        const existing = entriesByUrl.get(summary.url);
        if (!existing || summary.usedBytes > existing.usedBytes) {
            entriesByUrl.set(summary.url, summary);
        }
    }
}

const summaries = Array.from(entriesByUrl.values()).sort((left, right) =>
    left.url.localeCompare(right.url)
);
const outputDir = path.join(workspaceRoot, 'coverage/e2e-v8/web');
mkdirSync(outputDir, { recursive: true });
writeFileSync(
    path.join(outputDir, 'summary.json'),
    `${JSON.stringify(
        {
            rawCoverageRoot: path.relative(workspaceRoot, rawCoverageRoot),
            rawFiles: rawFiles.length,
            scripts: summaries,
        },
        null,
        4
    )}\n`
);
writeFileSync(
    path.join(outputDir, 'summary.md'),
    `# Web E2E V8 Coverage

Raw coverage root: ${path.relative(workspaceRoot, rawCoverageRoot)}

Raw coverage files: ${rawFiles.length}

This experimental report is Chromium/V8 byte coverage from Playwright's browser
coverage API. Use it for local investigation; rely on Tier A unit coverage and
E2E semantic coverage for CI gates.

| Script URL | Used bytes | Source bytes | Byte coverage |
| --- | ---: | ---: | ---: |
${summaries
    .map(
        (entry) =>
            `| ${entry.url || '_anonymous_'} | ${entry.usedBytes} | ${entry.sourceLength} | ${entry.pct}% |`
    )
    .join('\n') || '| _none_ | 0 | 0 | 0% |'}
`
);

console.log(`Wrote coverage/e2e-v8/web/summary.md from ${rawFiles.length} raw coverage files.`);
