import { execFileSync } from 'node:child_process';
import { withRuntimeCoverage } from '@iptvnator/shared/testing/runtime-coverage';

describe('activity delivery across real browser tabs', () => {
    it(
        'preserves live ownership and recovers a closed tab without Web Locks',
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
            import { runtimeCoveragePlugin, writeRuntimeCoverage } from '@iptvnator/shared/testing/runtime-coverage';
            import { chromium } from '@playwright/test';
            import { applyActivityOperation, emptyActivityState } from './libs/shared/interfaces/src/lib/activity-sync/activity-sync.reducer.ts';
            const bundle = (await build({ stdin: {
                contents: 'import { ActivitySyncClient, IndexedDbActivityLocalStore } from "@iptvnator/services/activity-sync"; window.activityTest = { ActivitySyncClient, IndexedDbActivityLocalStore };',
                resolveDir: process.cwd(), loader: 'ts',
            }, bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: 'tsconfig.base.json', plugins: [runtimeCoveragePlugin(/indexeddb-activity-local[.]ts$/)] })).outputFiles[0].text;
            let state = emptyActivityState();
            const receipts = new Map();
            let requests = 0;
            function remoteStart(id) {
                state = applyActivityOperation(state, { kind: 'begin', deviceId: 'synthetic-remote', operationId: id + '-begin', expectedRevision: state.revision, sessionId: id }).state;
                state = applyActivityOperation(state, { kind: 'checkpoint', deviceId: 'synthetic-remote', operationId: id + '-tick', generation: state.generation, sessionId: id, sequence: 1, resume: { positionSeconds: 30, durationSeconds: 100 } }).state;
            }
            remoteStart('synthetic-remote-first');
            const snapshots = [];
            const capture = async page => snapshots.push(await page.evaluate(() => globalThis.__coverage__ ?? {}));
            const browser = await chromium.launch({ headless: true });
            try {
                const context = await browser.newContext();
                await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
                await context.route('http://activity.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
                await context.route('http://activity.test/api', async route => {
                    requests++;
                    const operation = route.request().postDataJSON().activity.operation;
                    const result = receipts.get(operation.operationId) ?? applyActivityOperation(state, operation);
                    receipts.set(operation.operationId, structuredClone(result));
                    if (result.status === 'applied') state = structuredClone(result.state);
                    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, body: result }) });
                });
                const pages = await Promise.all([context.newPage(), context.newPage()]);
                for (const page of pages) {
                    await page.goto('http://activity.test/');
                    await page.addScriptTag({ content: bundle });
                    await page.evaluate(() => {
                        const { ActivitySyncClient, IndexedDbActivityLocalStore } = window.activityTest;
                        const store = new IndexedDbActivityLocalStore('synthetic-instance');
                        const client = new ActivitySyncClient(store, {
                            instanceId: 'synthetic-instance', deviceId: 'synthetic-device', consent: () => 'synthetic-consent',
                            contexts: [{ sourceId: 'synthetic-source', provider: 'xtream', sourceIncarnation: 'synthetic-incarnation' }],
                            request: async input => (await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).json(),
                            changed() {}, status() {},
                        });
                        const flush = client.flush.bind(client);
                        window.deliveryTest = { store, client, flush };
                    });
                }
                async function enqueue(session) {
                    await pages[0].evaluate(async session => {
                        const { client } = window.deliveryTest;
                        client.flush = async () => undefined;
                        const position = { playlistId: 'synthetic-source', contentType: 'vod', contentXtreamId: 42, positionSeconds: 40, durationSeconds: 100, activitySessionId: session };
                        await client.begin('synthetic-source', position);
                        await client.save('synthetic-source', position);
                    }, session);
                }
                await enqueue('synthetic-live');
                const blocked = await pages[1].evaluate(async () => {
                    const { client, store } = window.deliveryTest;
                    await client.flush();
                    return await store.entries('synthetic-source');
                });
                assert.equal(requests, 0);
                assert.equal(blocked[0].record.conflict, undefined);
                assert.ok(blocked[0].record.pending[0].deliveryLease);
                await pages[0].evaluate(async () => {
                    const t = window.deliveryTest;
                    t.client.flush = t.flush;
                    await t.flush();
                });
                assert.equal(state.owner.sessionId, 'synthetic-live');
                assert.equal(state.resume.positionSeconds, 40);
                assert.deepEqual(await pages[1].evaluate(() => window.deliveryTest.store.pending()), []);
                await enqueue('synthetic-abandoned');
                remoteStart('synthetic-remote-later');
                await capture(pages[0]);
                await pages[0].close();
                const recovered = await pages[1].evaluate(async () => {
                    const { client, store } = window.deliveryTest;
                    const entry = (await store.entries('synthetic-source'))[0];
                    // Simulate lease expiry without a wall-clock sleep.
                    await store.mutate(entry.address, current => ({ ...current, pending: current.pending.map(intent => ({ ...intent, deliveryLease: { ...intent.deliveryLease, expiresAt: Date.now() - 1 } })) }));
                    await client.flush();
                    return await store.read(entry.address);
                });
                assert.ok(recovered.conflict);
                assert.equal(state.owner.sessionId, 'synthetic-remote-later');
                assert.equal(state.resume.positionSeconds, 30);
                for (const page of pages.filter(page => !page.isClosed())) await capture(page);
                writeRuntimeCoverage(process.env.IPTVNATOR_TEST_COVERAGE_FILE, snapshots);
                await context.close();
                process.stdout.write('synthetic activity delivery verified');
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
                expect(result).toBe('synthetic activity delivery verified');
            }),
        65_000
    );
});
