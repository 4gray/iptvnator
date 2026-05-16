import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { getDistFreshness } from './ensure-local-dist-fresh.mjs';

function touch(path, mtime) {
    writeFileSync(path, String(mtime));
    const time = new Date(mtime);
    utimesSync(path, time, time);
}

function createWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'iptvnator-dist-fresh-'));
    for (const dir of [
        'apps/electron-backend/src/app',
        'apps/web/src/app',
        'libs/example/src',
        'dist/apps/electron-backend',
        'dist/apps/web',
    ]) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    return root;
}

test('marks frontend stale when web source is newer than frontend output', () => {
    const root = createWorkspace();
    try {
        touch(join(root, 'dist/apps/web/index.html'), '2026-01-01T00:00:00Z');
        touch(
            join(root, 'dist/apps/electron-backend/main.js'),
            '2026-01-01T00:00:00Z'
        );
        touch(
            join(root, 'dist/apps/electron-backend/main.preload.js'),
            '2026-01-01T00:00:00Z'
        );
        touch(
            join(root, 'apps/web/src/main.ts'),
            '2026-01-02T00:00:00Z'
        );

        assert.deepEqual(
            {
                backendStale: getDistFreshness(root).backendStale,
                frontendStale: getDistFreshness(root).frontendStale,
            },
            {
                backendStale: false,
                frontendStale: true,
            }
        );
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('marks backend stale when backend source is newer than main output', () => {
    const root = createWorkspace();
    try {
        touch(join(root, 'dist/apps/web/index.html'), '2026-01-02T00:00:00Z');
        touch(
            join(root, 'dist/apps/electron-backend/main.js'),
            '2026-01-01T00:00:00Z'
        );
        touch(
            join(root, 'dist/apps/electron-backend/main.preload.js'),
            '2026-01-02T00:00:00Z'
        );
        touch(
            join(root, 'apps/electron-backend/src/app/app.ts'),
            '2026-01-02T00:00:00Z'
        );

        assert.deepEqual(
            {
                backendStale: getDistFreshness(root).backendStale,
                frontendStale: getDistFreshness(root).frontendStale,
            },
            {
                backendStale: true,
                frontendStale: false,
            }
        );
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});

test('marks dist fresh when outputs are newer than source', () => {
    const root = createWorkspace();
    try {
        touch(join(root, 'apps/web/src/main.ts'), '2026-01-01T00:00:00Z');
        touch(join(root, 'dist/apps/web/index.html'), '2026-01-02T00:00:00Z');
        touch(
            join(root, 'dist/apps/electron-backend/main.js'),
            '2026-01-02T00:00:00Z'
        );
        touch(
            join(root, 'dist/apps/electron-backend/main.preload.js'),
            '2026-01-02T00:00:00Z'
        );

        const freshness = getDistFreshness(root);
        assert.equal(freshness.backendStale, false);
        assert.equal(freshness.frontendStale, false);
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
});
