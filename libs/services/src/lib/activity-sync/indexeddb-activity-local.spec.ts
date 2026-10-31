import { execFileSync } from 'node:child_process';

describe('activity outbox in real browser IndexedDB', () => {
    it('serializes two tabs without Web Locks and survives rollback, reload and profile changes', () => {
        // A child Node process avoids jsdom shims; the adapter itself runs in
        // two real Chromium pages sharing one origin and IndexedDB connection queue.
        const result = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `
            import assert from 'node:assert/strict';
            import { buildSync } from 'esbuild';
            import { chromium } from '@playwright/test';
            const bundle = buildSync({
                stdin: {
                    contents: 'import { IndexedDbActivityLocalStore } from "@iptvnator/services/activity-sync"; import { appendActivityIntent, emptyActivityState } from "@iptvnator/shared/interfaces/activity-sync"; window.activityTest = { IndexedDbActivityLocalStore, appendActivityIntent, emptyActivityState };',
                    resolveDir: process.cwd(), loader: 'ts',
                },
                bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: 'tsconfig.base.json',
            }).outputFiles[0].text;
            const browser = await chromium.launch({ headless: true });
            try {
                const context = await browser.newContext();
                await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
                await context.route('http://activity.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
                const pages = await Promise.all([context.newPage(), context.newPage()]);
                for (const page of pages) {
                    await page.goto('http://activity.test/');
                    await page.addScriptTag({ content: bundle });
                }
                const address = {
                    instanceId: 'nas', scope: 'shared', sourceId: 'source', sourceIncarnation: 'first',
                    content: { provider: 'xtream', kind: 'vod', id: '42' },
                };
                await Promise.all(pages.map((page, tab) => page.evaluate(async ({ address, tab }) => {
                    const { IndexedDbActivityLocalStore, appendActivityIntent, emptyActivityState } = window.activityTest;
                    const store = new IndexedDbActivityLocalStore('nas');
                    for (let index = 0; index < 20; index++) {
                        await store.mutate(address, current => appendActivityIntent(current, {
                            ...emptyActivityState(), revision: (current?.state.revision ?? 0) + 1,
                        }, {
                            address, consentGeneration: 'consent-1',
                            operation: { kind: 'reset', expectedRevision: 0, deviceId: 'tab-' + tab, operationId: 'op-' + index },
                        }));
                    }
                }, { address, tab })));
                const saved = await pages[0].evaluate(async address => {
                    const store = new window.activityTest.IndexedDbActivityLocalStore('nas');
                    return { record: await store.read(address), pending: await store.pending() };
                }, address);
                assert.equal(saved.record.state.revision, 40);
                assert.equal(saved.record.pending.length, 40);
                assert.equal(saved.pending.length, 40);
                const rollback = await pages[1].evaluate(async address => {
                    const store = new window.activityTest.IndexedDbActivityLocalStore('nas');
                    const before = await store.read(address);
                    let rejected = false;
                    try { await store.mutate(address, current => {
                        current.pending.length = 0;
                        throw new Error('simulated failure');
                    }); } catch { rejected = true; }
                    let profileRejected = false;
                    try { await store.read({ ...address, instanceId: 'other' }); }
                    catch { profileRejected = true; }
                    let cloneRejected = false;
                    try { await store.mutate(address, current => ({ ...current, uncloneable: () => {} })); }
                    catch { cloneRejected = true; }
                    return { before, after: await store.read(address), rejected, profileRejected, cloneRejected };
                }, address);
                assert.equal(rollback.rejected, true);
                assert.equal(rollback.profileRejected, true);
                assert.equal(rollback.cloneRejected, true);
                assert.deepEqual(rollback.after, rollback.before);
                await pages[0].reload();
                await pages[0].addScriptTag({ content: bundle });
                const reopened = await pages[0].evaluate(async address => {
                    const store = new window.activityTest.IndexedDbActivityLocalStore('nas');
                    const other = new window.activityTest.IndexedDbActivityLocalStore('other');
                    return { saved: await store.read(address), pending: await store.pending(), other: await other.read({ ...address, instanceId: 'other' }) };
                }, address);
                assert.deepEqual(reopened.saved, saved.record);
                assert.deepEqual(reopened.pending, saved.pending);
                assert.equal(reopened.other, null);
                const acknowledged = await pages[1].evaluate(async address => {
                    const store = new window.activityTest.IndexedDbActivityLocalStore('nas');
                    await store.mutate(address, current => ({ ...current, pending: [] }));
                    return { record: await store.read(address), pending: await store.pending() };
                }, address);
                assert.deepEqual(acknowledged.pending, []);
                assert.deepEqual(acknowledged.record.state, saved.record.state);
                await context.close();
                process.stdout.write('activity IndexedDB verified');
            } finally { await browser.close(); }
        `,
            ],
            { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 }
        );
        expect(result).toBe('activity IndexedDB verified');
    }, 65_000);
});
