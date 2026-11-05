import { execFileSync } from 'node:child_process';
import { withRuntimeCoverage } from '@iptvnator/shared/testing/runtime-coverage';

describe('favorites outbox in real browser IndexedDB', () => {
    it(
        'serializes tabs without Web Locks and retains state/outbox through rollback and reload',
        async () =>
            withRuntimeCoverage((coverageFile) => {
                const result = execFileSync(
                    process.execPath,
                    [
                        '--import',
                        'tsx',
                        '--input-type=module',
                        '-e',
                        `
            import assert from 'node:assert/strict';
            import { build } from 'esbuild';
            import { chromium } from '@playwright/test';
            import { runtimeCoveragePlugin, writeRuntimeCoverage } from '@iptvnator/shared/testing/runtime-coverage';
            const options = { platform: 'browser', plugins: [runtimeCoveragePlugin(/indexeddb-favorites-local[.]ts$/)] };
            const result = await build({ stdin: { contents: "export { IndexedDbFavoriteLocalStore } from './libs/services/src/lib/favorites-sync/indexeddb-favorites-local'; export { FavoritesSyncClient } from './libs/services/src/lib/favorites-sync/favorites-sync-client'; export { m3uFavoriteReference } from './libs/shared/interfaces/src/lib/favorites-sync/favorites-sync.reducer'; export { createRandomId } from './libs/shared/interfaces/src/lib/random-id.util';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'favoritesTest', tsconfig: 'tsconfig.base.json', ...options });
            const bundle = result.outputFiles[0].text;
            const browser = await chromium.launch({ headless: true });
            const snapshots = [];
            try {
                const context = await browser.newContext();
                await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
                await context.route('http://favorites.test/**', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
                const pages = await Promise.all([context.newPage(), context.newPage()]);
                for (const page of pages) { await page.goto('http://favorites.test'); await page.addScriptTag({ content: bundle }); }
                const http = await pages[0].evaluate(async () => {
                    const api = window.favoritesTest;
                    const source = { sourceId: 'source', sourceIncarnation: 'first', provider: 'xtream' };
                    const store = new api.IndexedDbFavoriteLocalStore('http-nas');
                    const client = new api.FavoritesSyncClient(store, { instanceId: 'http-nas', deviceId: api.createRandomId(), contexts: [source], consent: () => 'consent', request: async () => { throw new Error('offline'); }, remember: () => undefined, changed: () => undefined });
                    await client.set('source', { provider: 'xtream', kind: 'movie', id: '99' }, true);
                    return { secure: isSecureContext, subtle: typeof crypto.subtle, randomUUID: typeof crypto.randomUUID, hash: (await api.m3uFavoriteReference('https://synthetic.invalid/stream')).urlHash, pending: await store.pending() };
                });
                assert.equal(http.secure, false); assert.equal(http.subtle, 'undefined'); assert.equal(http.randomUUID, 'undefined');
                assert.equal(http.hash, '59936cfe563ba8f9672e4c077e3f9a8f7473db9bd9ce922aa97aa9081165d271'); assert.equal(http.pending.length, 1);
                assert.match(http.pending[0].operation.operationId, /^[a-f0-9-]{36}$/);
                const address = { instanceId: 'nas', scope: 'shared', sourceId: 'source', sourceIncarnation: 'first', content: { provider: 'xtream', kind: 'movie', id: '42' } };
                await Promise.all(pages.map((page, tab) => page.evaluate(async ({ address, tab }) => {
                    const store = new window.favoritesTest.IndexedDbFavoriteLocalStore('nas');
                    for (let i = 0; i < 20; i++) await store.mutate(address, current => ({
                        base: current?.base ?? { revision: 0, member: false },
                        state: { revision: (current?.state.revision ?? 0) + 1, member: tab === 0 },
                        pending: [...(current?.pending ?? []), { address, consentGeneration: 'consent-1', operation: {
                            operationId: 'op-' + tab + '-' + i, deviceId: 'device-' + tab, expectedRevision: current?.state.revision ?? 0, member: tab === 0,
                        } }],
                    }));
                }, { address, tab })));
                const saved = await pages[0].evaluate(async address => new window.favoritesTest.IndexedDbFavoriteLocalStore('nas').read(address), address);
                assert.equal(saved.state.revision, 40); assert.equal(saved.pending.length, 40);
                const checked = await pages[1].evaluate(async address => {
                    const store = new window.favoritesTest.IndexedDbFavoriteLocalStore('nas');
                    let rollback = false; let profile = false;
                    try { await store.mutate(address, current => { current.pending.length = 0; throw new Error('synthetic failure'); }); } catch { rollback = true; }
                    try { await store.read({ ...address, instanceId: 'other' }); } catch { profile = true; }
                    return { row: await store.read(address), pending: await store.pending(), rollback, profile };
                }, address);
                assert.deepEqual(checked.row, saved); assert.equal(checked.pending.length, 40); assert.ok(checked.rollback && checked.profile);
                snapshots.push(await pages[0].evaluate(() => globalThis.__coverage__ ?? {}));
                await pages[0].reload(); await pages[0].addScriptTag({ content: bundle });
                const reopened = await pages[0].evaluate(async address => new window.favoritesTest.IndexedDbFavoriteLocalStore('nas').read(address), address);
                assert.deepEqual(reopened, saved);
                for (const page of pages) snapshots.push(await page.evaluate(() => globalThis.__coverage__ ?? {}));
                writeRuntimeCoverage(process.env.IPTVNATOR_TEST_COVERAGE_FILE, snapshots);
                await context.close(); process.stdout.write('favorites IndexedDB verified');
            } finally { await browser.close(); }
        `,
                    ],
                    {
                        cwd: process.cwd(),
                        encoding: 'utf8',
                        timeout: 60_000,
                        env: {
                            ...process.env,
                            TSX_TSCONFIG_PATH: 'tsconfig.base.json',
                            IPTVNATOR_TEST_COVERAGE_FILE: coverageFile,
                        },
                    }
                );
                expect(result).toBe('favorites IndexedDB verified');
            }),
        65_000
    );
});
