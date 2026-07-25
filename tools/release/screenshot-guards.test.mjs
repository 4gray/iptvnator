import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
    buildCaptureEnv,
    compareDatabaseStates,
    evaluateFrameReport,
    externalRequestViolations,
    isAllowedRequestUrl,
    manifestSlugs,
    parseSetupStep,
    snapshotDatabaseState,
    stubbedResponseFor,
    validateManifest,
} from './screenshot-guards.mjs';

const tempDirs = [];

after(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function validManifest() {
    return {
        version: 1,
        viewport: { width: 1280, height: 720 },
        themes: ['dark', 'light'],
        shots: [
            { slug: 'dashboard', title: 'Dashboard', setup: ['open-dashboard'] },
            {
                slug: 'vod',
                title: 'VOD',
                setup: ['open-xtream-vod=Hero Premieres'],
            },
        ],
    };
}

describe('manifest validation', () => {
    it('accepts the committed manifest shape', () => {
        assert.deepEqual(validateManifest(validManifest()), []);
    });

    it('rejects unknown setup actions, bad slugs and duplicates', () => {
        const manifest = validManifest();
        manifest.shots.push(
            { slug: 'Bad Slug', title: 'x', setup: ['open-dashboard'] },
            { slug: 'dashboard', title: 'dupe', setup: ['fly-to-the-moon'] }
        );

        const errors = validateManifest(manifest);

        assert.ok(errors.some((error) => /slug must be a lowercase/.test(error)));
        assert.ok(errors.some((error) => /duplicate slug/.test(error)));
        assert.ok(
            errors.some((error) => /unknown setup action "fly-to-the-moon"/.test(error))
        );
    });

    it('rejects an empty or missing shots array', () => {
        assert.ok(validateManifest({ version: 1, shots: [] }).length > 0);
        assert.ok(validateManifest({ version: 1 }).length > 0);
    });

    it('parses setup steps with and without a parameter', () => {
        assert.deepEqual(parseSetupStep('open-dashboard'), {
            action: 'open-dashboard',
            param: null,
        });
        assert.deepEqual(parseSetupStep('open-xtream-vod=Hero Premieres'), {
            action: 'open-xtream-vod',
            param: 'Hero Premieres',
        });
    });

    it('exposes slugs for .changes screenshot validation', () => {
        assert.deepEqual(
            [...manifestSlugs(validManifest())],
            ['dashboard', 'vod']
        );
    });
});

describe('G2 — environment allowlist', () => {
    it('keeps only allowlisted variables plus explicit overrides', () => {
        const env = buildCaptureEnv(
            {
                PATH: '/usr/bin',
                HOME: '/Users/x',
                LC_ALL: 'en_US.UTF-8',
                XDG_RUNTIME_DIR: '/run/user/1000',
                TMDB_API_KEY: 'leaky-secret',
                HTTPS_PROXY: 'http://proxy:8080',
                IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                AWS_SECRET_ACCESS_KEY: 'nope',
            },
            { NODE_ENV: 'test', IPTVNATOR_E2E_DATA_DIR: '/tmp/x' }
        );

        assert.deepEqual(env, {
            PATH: '/usr/bin',
            HOME: '/Users/x',
            LC_ALL: 'en_US.UTF-8',
            XDG_RUNTIME_DIR: '/run/user/1000',
            NODE_ENV: 'test',
            IPTVNATOR_E2E_DATA_DIR: '/tmp/x',
        });
    });

    it('drops undefined values', () => {
        assert.deepEqual(buildCaptureEnv({ PATH: undefined }, {}), {});
    });
});

describe('G3 — network gate', () => {
    it('allows localhost, loopback and internal schemes', () => {
        for (const url of [
            'http://localhost:3211/player_api.php?username=marketing',
            'http://127.0.0.1:3211/assets/logo.svg',
            'ws://localhost:4200/ng-cli-ws',
            'file:///dist/apps/web/index.html',
            'data:image/png;base64,AAA',
            'blob:file:///abc',
            'about:blank',
            'devtools://devtools/bundled/root.js',
        ]) {
            assert.equal(isAllowedRequestUrl(url), true, url);
        }
    });

    it('blocks everything external', () => {
        for (const url of [
            'https://api.themoviedb.org/3/trending/all/week',
            'https://image.tmdb.org/t/p/w500/x.jpg',
            'http://real-provider.example:8080/live/user/pass/1.m3u8',
            'https://localhost.evil.example/x', // suffix-spoofed hostname
            'http://192.168.1.50/stream.ts',
            'not a url',
        ]) {
            assert.equal(isAllowedRequestUrl(url), false, url);
        }
    });
});

describe('G3 — local stubs', () => {
    it('stubs the GitHub releases update check with an empty payload', () => {
        const stub = stubbedResponseFor(
            'https://api.github.com/repos/4gray/iptvnator/releases?per_page=100'
        );

        assert.deepEqual(stub, { body: '[]', contentType: 'application/json' });
    });

    it('stubs nothing else', () => {
        for (const url of [
            'https://api.github.com/repos/4gray/iptvnator/issues',
            'https://api.github.com/repos/other/repo/releases',
            'https://api.themoviedb.org/3/trending/all/week',
            'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        ]) {
            assert.equal(stubbedResponseFor(url), null, url);
        }
    });
});

describe('G4 — frame content assertions', () => {
    it('passes a frame with only mock resources and clean text', () => {
        const violations = evaluateFrameReport({
            resourceUrls: [
                'http://localhost:3211/assets/marketing/poster/crimson-skylark.svg',
                'data:image/svg+xml;base64,AAA',
            ],
            bodyText: 'Crimson Skylark\nHero Premieres\nAurora Local',
        });

        assert.deepEqual(violations, []);
    });

    it('flags external artwork in the frame', () => {
        const violations = evaluateFrameReport({
            resourceUrls: ['https://image.tmdb.org/t/p/w500/poster.jpg'],
            bodyText: '',
        });

        assert.equal(violations.length, 1);
        assert.match(violations[0], /external resource/);
    });

    it('flags credential-shaped URLs, MAC addresses and external m3u8 text', () => {
        const violations = evaluateFrameReport({
            resourceUrls: [],
            bodyText: [
                'http://provider.example/get.php?username=real&password=secret',
                '00:1A:79:12:34:56',
                'stream at http://cdn.example/live/42.m3u8 is down',
            ].join('\n'),
        });

        assert.equal(violations.length, 3);
        assert.ok(violations.every((entry) => /credential-shaped/.test(entry)));
    });

    it('does not flag the mock server stream URL', () => {
        const violations = evaluateFrameReport({
            resourceUrls: [],
            bodyText: 'http://localhost:3211/live/marketing/marketing/52000.m3u8',
        });

        assert.deepEqual(violations, []);
    });
});

describe('G1 — real database untouched', () => {
    function tempDbDir(files) {
        const dir = mkdtempSync(path.join(tmpdir(), 'guard-db-'));
        tempDirs.push(dir);

        for (const [name, content] of Object.entries(files)) {
            writeFileSync(path.join(dir, name), content);
        }

        return dir;
    }

    it('reports no violation for an untouched directory', () => {
        const dir = tempDbDir({
            'iptvnator.db': 'main',
            'iptvnator.db-wal': 'wal',
            'iptvnator.db-shm': 'shm',
        });

        assert.equal(
            compareDatabaseStates(
                snapshotDatabaseState(dir),
                snapshotDatabaseState(dir)
            ),
            null
        );
    });

    it('reports no violation when the directory does not exist', () => {
        const missing = snapshotDatabaseState('/definitely/not/here-9d3f');

        assert.equal(missing.exists, false);
        assert.equal(compareDatabaseStates(missing, missing), null);
    });

    it('detects a write that only lands in the WAL sidecar', () => {
        // The exact hole this replaced: hashing iptvnator.db alone missed
        // writes that SQLite parks in -wal until a checkpoint.
        const dir = tempDbDir({ 'iptvnator.db': 'main', 'iptvnator.db-wal': 'w' });
        const before = snapshotDatabaseState(dir);
        writeFileSync(path.join(dir, 'iptvnator.db-wal'), 'w+more');

        assert.match(
            compareDatabaseStates(before, snapshotDatabaseState(dir)),
            /iptvnator\.db-wal was modified/
        );
    });

    it('detects a bare touch of the main database', () => {
        const dir = tempDbDir({ 'iptvnator.db': 'same-bytes' });
        const before = snapshotDatabaseState(dir);
        utimesSync(
            path.join(dir, 'iptvnator.db'),
            new Date(),
            new Date(Date.now() + 5_000)
        );

        assert.match(
            compareDatabaseStates(before, snapshotDatabaseState(dir)),
            /iptvnator\.db was modified/
        );
    });

    it('detects added and removed sidecars', () => {
        const dir = tempDbDir({ 'iptvnator.db': 'main' });
        const before = snapshotDatabaseState(dir);
        writeFileSync(path.join(dir, 'iptvnator.db-wal'), 'new');
        const after = snapshotDatabaseState(dir);

        assert.match(compareDatabaseStates(before, after), /gained iptvnator\.db-wal/);
        assert.match(compareDatabaseStates(after, before), /lost iptvnator\.db-wal/);
    });

    it('detects a directory that appears during the run', () => {
        const dir = tempDbDir({ 'iptvnator.db': 'x' });

        assert.match(
            compareDatabaseStates({ exists: false, entries: {} }, snapshotDatabaseState(dir)),
            /CREATED/
        );
    });

    it('does not hash the database, so multi-gigabyte files are fine', () => {
        // Regression guard: the previous implementation read the whole file
        // into memory and swallowed the resulting failure as "absent",
        // silently disabling G1 against a 4 GB production database.
        const dir = tempDbDir({ 'iptvnator.db': 'x' });
        const snapshot = snapshotDatabaseState(dir);

        assert.equal(snapshot.exists, true);
        assert.ok(!('sha256' in snapshot.entries['iptvnator.db']));
        assert.ok(snapshot.entries['iptvnator.db'].ino > 0);
    });
});

describe('external request verdict', () => {
    it('ignores local and stubbed URLs, reports the rest once', () => {
        const violations = externalRequestViolations([
            'http://localhost:3211/player_api.php',
            'file:///dist/apps/web/index.html',
            'https://api.github.com/repos/4gray/iptvnator/releases',
            'https://image.tmdb.org/t/p/w500/a.jpg',
            'https://image.tmdb.org/t/p/w500/a.jpg',
            'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        ]);

        assert.deepEqual(violations, [
            'https://image.tmdb.org/t/p/w500/a.jpg',
            'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        ]);
    });

    it('returns nothing for a fully local run', () => {
        assert.deepEqual(
            externalRequestViolations([
                'http://127.0.0.1:3211/assets/logo.svg',
                'data:image/png;base64,AAA',
            ]),
            []
        );
    });
});
