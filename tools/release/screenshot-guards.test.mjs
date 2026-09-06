import assert from 'node:assert/strict';
import {
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
    buildCaptureEnv,
    HOST_RESOLVER_RULES,
    networkPolicy,
    publishDirectory,
    compareDatabaseStates,
    evaluateFrameReport,
    externalRequestViolations,
    isAllowedRequestUrl,
    manifestSlugs,
    parseSetupStep,
    snapshotDatabaseState,
    stubbedResponseFor,
    DEFAULT_SHOT_GROUP,
    FICTIONAL_STALKER_MAC,
    outputDirectoryFor,
    shotGroup,
    validateManifest,
    validateReleaseSlug,
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

describe('frame guard MAC allowlist', () => {
    it('lets the fictional marketing-demo MAC through but no other MAC', () => {
        const clean = evaluateFrameReport({
            resourceUrls: [],
            bodyText: `Mac Address ${FICTIONAL_STALKER_MAC} Serial Number`,
        });
        assert.deepEqual(clean, []);

        const leaked = evaluateFrameReport({
            resourceUrls: [],
            bodyText: `Mac Address ${FICTIONAL_STALKER_MAC} and 00:1A:79:12:34:56`,
        });
        assert.ok(
            leaked.some((violation) => /00:1A:79:12:34:56/.test(violation)),
            'a second MAC must still fail the frame'
        );
    });
});

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

    it('rejects a manifest that does not carry exactly dark and light', () => {
        for (const themes of [['dark'], ['dark', 'drak'], [], undefined, 'dark']) {
            const manifest = { ...validManifest(), themes };

            assert.ok(
                validateManifest(manifest).some((error) =>
                    /`themes` must be exactly/.test(error)
                ),
                `should reject themes: ${JSON.stringify(themes)}`
            );
        }
    });

    it('accepts dark and light in either order', () => {
        const manifest = { ...validManifest(), themes: ['light', 'dark'] };

        assert.deepEqual(validateManifest(manifest), []);
    });

    it('rejects an empty or missing shots array', () => {
        assert.ok(
            validateManifest({ version: 1, themes: ['dark', 'light'], shots: [] })
                .length > 0
        );
        assert.ok(
            validateManifest({ version: 1, themes: ['dark', 'light'] }).length > 0
        );
    });

    it('accepts a loopback browser shot and rejects any other origin', () => {
        const manifest = validManifest();
        manifest.shots.push({
            slug: 'guide-remote-phone',
            title: 'Phone view',
            group: 'guides',
            setup: ['enable-remote-control'],
            browser: { url: 'http://127.0.0.1:8765/', viewport: { width: 390, height: 844 } },
        });

        assert.deepEqual(validateManifest(manifest), []);

        manifest.shots.push(
            {
                slug: 'guide-remote-elsewhere',
                title: 'x',
                group: 'guides',
                setup: ['enable-remote-control'],
                browser: { url: 'https://example.com/', viewport: { width: 390, height: 844 } },
            },
            {
                slug: 'guide-remote-tiny',
                title: 'x',
                group: 'guides',
                setup: ['enable-remote-control'],
                browser: { url: 'http://localhost:8765/', viewport: { width: 10 } },
            }
        );

        const errors = validateManifest(manifest);

        assert.ok(errors.some((error) => /browser\.url must be a loopback/.test(error)));
        assert.ok(errors.some((error) => /browser\.viewport must carry/.test(error)));
    });

    it('accepts guide shots that name a group and the actions they use', () => {
        const manifest = validManifest();
        manifest.shots.push(
            {
                slug: 'guide-xtream-add-playlist',
                title: 'Add playlist',
                group: 'guides',
                setup: ['open-add-playlist-xtream'],
            },
            {
                slug: 'guide-xtream-auto-detect',
                title: 'Auto-detect',
                group: 'guides',
                setup: ['open-add-playlist-auto'],
            },
            {
                slug: 'guide-xtream-live',
                title: 'Live TV',
                group: 'guides',
                setup: ['open-xtream-live=News'],
            }
        );

        assert.deepEqual(validateManifest(manifest), []);
    });

    it('rejects a group that is not a lowercase slug', () => {
        const manifest = validManifest();
        manifest.shots.push({
            slug: 'guide',
            title: 'x',
            group: '../v0-24',
            setup: ['open-dashboard'],
        });

        assert.ok(
            validateManifest(manifest).some((error) =>
                /group must be a lowercase slug/.test(error)
            )
        );
    });

    it('routes release shots by release and grouped shots by group', () => {
        assert.equal(shotGroup({ slug: 'dashboard' }), DEFAULT_SHOT_GROUP);
        assert.equal(shotGroup({ slug: 'guide', group: 'guides' }), 'guides');
        assert.equal(
            outputDirectoryFor({ blogRoot: '/blog', group: DEFAULT_SHOT_GROUP, release: 'v0-24' }),
            path.join('/blog', 'v0-24', 'screenshots')
        );
        assert.equal(
            outputDirectoryFor({ blogRoot: '/blog', group: 'guides', release: 'v0-24' }),
            path.join('/blog', 'guides', 'screenshots')
        );
    });

    it('accepts the Stalker guide actions', () => {
        const manifest = validManifest();
        manifest.shots.push(
            {
                slug: 'guide-stalker-add-playlist',
                title: 'Stalker form',
                group: 'guides',
                setup: ['open-add-playlist-stalker'],
            },
            {
                slug: 'guide-stalker-live',
                title: 'Stalker live',
                group: 'guides',
                setup: ['open-stalker-live'],
            },
            {
                slug: 'guide-m3u-add-playlist',
                title: 'M3U URL form',
                group: 'guides',
                setup: ['open-add-playlist-m3u-url'],
            },
            {
                slug: 'guide-epg-settings',
                title: 'EPG settings',
                group: 'guides',
                setup: ['open-settings-epg'],
            }
        );

        assert.deepEqual(validateManifest(manifest), []);
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

describe('host resolver gate', () => {
    it('blocks every host except the local mock', () => {
        assert.match(HOST_RESOLVER_RULES, /^MAP \* ~NOTFOUND/);
        assert.match(HOST_RESOLVER_RULES, /EXCLUDE localhost/);
        assert.match(HOST_RESOLVER_RULES, /EXCLUDE 127\.0\.0\.1/);
    });
});

describe('release slug validation', () => {
    it('accepts ordinary release slugs', () => {
        for (const slug of ['v0-24', 'v0-24.1', 'v-smoke-test', 'v1-0']) {
            assert.equal(validateReleaseSlug(slug), null, slug);
        }
    });

    it('rejects traversal and separators that would escape the blog tree', () => {
        for (const slug of [
            '../../assets',
            '..',
            'v0-24/../../etc',
            '/etc/passwd',
            'v0-24/nested',
            'V0-24',
            '',
        ]) {
            assert.ok(validateReleaseSlug(slug), `should reject: ${slug}`);
        }
    });
});

describe('network policy handed to the main process', () => {
    it('carries the same data the in-process predicate uses', () => {
        const policy = networkPolicy();

        assert.ok(policy.schemes.includes('file:'));
        assert.ok(policy.hosts.includes('127.0.0.1'));
        assert.ok(policy.protocols.includes('http:'));
        assert.deepEqual(policy.stubPrefixes, [
            'https://api.github.com/repos/4gray/iptvnator/releases',
        ]);
    });

    it('agrees with isAllowedRequestUrl on local and external URLs', () => {
        const policy = networkPolicy();
        const isLocal = (url) => {
            if (policy.stubPrefixes.some((p) => url.startsWith(p))) return true;
            try {
                const parsed = new URL(url);
                return (
                    policy.schemes.includes(parsed.protocol) ||
                    (policy.protocols.includes(parsed.protocol) &&
                        policy.hosts.includes(parsed.hostname))
                );
            } catch {
                return policy.schemes.some((s) => url.startsWith(s));
            }
        };

        for (const url of [
            'http://localhost:3211/a',
            'file:///x/index.html',
            'data:image/png;base64,AAA',
            'blob:file:///abc',
        ]) {
            assert.equal(isLocal(url), isAllowedRequestUrl(url), url);
        }

        for (const url of [
            'https://image.tmdb.org/p.jpg',
            'https://test-streams.mux.dev/x.m3u8',
            'https://localhost.evil.example/x',
        ]) {
            assert.equal(isLocal(url), false, url);
            assert.equal(isAllowedRequestUrl(url), false, url);
        }
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

    it('keeps the X11 display credentials Electron needs on Linux', () => {
        // Without XAUTHORITY an xauth-based X11 session refuses the
        // connection and the capture dies before a window exists.
        const env = buildCaptureEnv(
            {
                DISPLAY: ':99',
                XAUTHORITY: '/run/user/1000/gdm/Xauthority',
                WAYLAND_DISPLAY: 'wayland-0',
                TMDB_API_KEY: 'leaky-secret',
            },
            {}
        );

        assert.deepEqual(env, {
            DISPLAY: ':99',
            XAUTHORITY: '/run/user/1000/gdm/Xauthority',
            WAYLAND_DISPLAY: 'wayland-0',
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

describe('publishDirectory', () => {
    function staged(files) {
        const dir = mkdtempSync(path.join(tmpdir(), 'guard-stage-'));
        tempDirs.push(dir);

        for (const [name, content] of Object.entries(files)) {
            writeFileSync(path.join(dir, name), content);
        }

        return dir;
    }

    function outputPath() {
        const parent = mkdtempSync(path.join(tmpdir(), 'guard-out-'));
        tempDirs.push(parent);

        return path.join(parent, 'screenshots');
    }

    it('publishes into a directory that does not exist yet', () => {
        const out = outputPath();
        const count = publishDirectory(
            staged({ 'a-dark.png': 'A', 'a-light.png': 'B' }),
            out,
            'test'
        );

        assert.equal(count, 2);
        assert.deepEqual(readdirSync(out).sort(), ['a-dark.png', 'a-light.png']);
    });

    it('replaces a previous set wholesale, leaving no stale files', () => {
        const out = outputPath();
        publishDirectory(staged({ 'old.png': 'OLD', 'a.png': 'v1' }), out, 't1');
        publishDirectory(staged({ 'a.png': 'v2' }), out, 't2');

        assert.deepEqual(readdirSync(out), ['a.png']);
        assert.equal(readFileSync(path.join(out, 'a.png'), 'utf8'), 'v2');
    });

    it('merge mode overlays a partial set without deleting the rest', () => {
        // The `--only` / `--theme` path: refreshing one shot must not wipe
        // the other screenshots of the release.
        const out = outputPath();
        publishDirectory(
            staged({ 'a-dark.png': 'A1', 'b-dark.png': 'B1' }),
            out,
            't1'
        );

        const count = publishDirectory(staged({ 'a-dark.png': 'A2' }), out, 't2', {
            mode: 'merge',
        });

        assert.equal(count, 1);
        assert.deepEqual(readdirSync(out).sort(), ['a-dark.png', 'b-dark.png']);
        assert.equal(readFileSync(path.join(out, 'a-dark.png'), 'utf8'), 'A2');
        assert.equal(readFileSync(path.join(out, 'b-dark.png'), 'utf8'), 'B1');
    });

    it('merge mode works when nothing was published before', () => {
        const out = outputPath();
        publishDirectory(staged({ 'a.png': 'A' }), out, 't', { mode: 'merge' });

        assert.deepEqual(readdirSync(out), ['a.png']);
    });

    it('leaves no scratch directories behind', () => {
        const out = outputPath();
        publishDirectory(staged({ 'a.png': 'A' }), out, 'tok');

        assert.deepEqual(readdirSync(path.dirname(out)), ['screenshots']);
    });

    it('rolls the previous set back when the swap fails', () => {
        const out = outputPath();
        publishDirectory(staged({ 'a.png': 'original' }), out, 't1');

        let calls = 0;
        const rename = (from, to) => {
            calls += 1;
            // First call retires the previous set; fail the swap that follows.
            if (calls === 2) {
                throw new Error('simulated EXDEV');
            }
            renameSync(from, to);
        };

        assert.throws(
            () =>
                publishDirectory(staged({ 'a.png': 'new' }), out, 'boom', {
                    rename,
                }),
            /simulated EXDEV/
        );

        assert.equal(calls, 3, 'the rollback rename must have run');
        assert.equal(readFileSync(path.join(out, 'a.png'), 'utf8'), 'original');
        assert.deepEqual(readdirSync(path.dirname(out)), ['screenshots']);
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
