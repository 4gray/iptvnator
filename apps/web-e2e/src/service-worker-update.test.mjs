import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const worker = readFileSync(
    require.resolve('@angular/service-worker/ngsw-worker.js'),
    'utf8'
);
const bootstrap = 'new Driver(scope, adapter, new CacheDatabase(adapter));';
assert.ok(
    worker.includes(bootstrap),
    'Update the worker harness after an Angular change'
);
const context = {
    self: {
        registration: { scope: 'https://audit.example.test/' },
        caches: {},
    },
    URL,
};
// Exercise the shipped Driver methods without starting a browser worker here.
runInNewContext(
    worker.replace(
        bootstrap,
        'globalThis.Driver = Driver; globalThis.States = DriverReadyState;'
    ),
    context
);

for (const state of ['NORMAL', 'EXISTING_CLIENTS_ONLY']) {
    test(`a failed candidate preserves the installed worker state (${state})`, async () => {
        const driver = Object.create(context.Driver.prototype);
        Object.assign(driver, {
            state: context.States[state],
            stateMessage: 'previous state',
            versions: new Map([['installed', {}]]),
            latestHash: 'installed',
            debugger: { log: () => undefined },
            fetchLatestManifest: async () => ({ configVersion: 1 }),
            notifyClientsAboutVersionDetected: async () => undefined,
            setupUpdate: async () => {
                throw new Error('candidate asset unavailable');
            },
        });

        assert.equal(await driver.checkForUpdate(), false);
        assert.equal(driver.state, context.States[state]);
        assert.equal(driver.stateMessage, 'previous state');
        assert.equal(driver.latestHash, 'installed');
        assert.deepEqual([...driver.versions.keys()], ['installed']);
    });
}

test('an explicit check offers the cached version to an older client', async () => {
    const manifest = { configVersion: 1 };
    const latest = createHash('sha1')
        .update(JSON.stringify(manifest))
        .digest('hex');
    const completed = [];
    const driver = Object.create(context.Driver.prototype);
    Object.assign(driver, {
        state: context.States.NORMAL,
        latestHash: latest,
        versions: new Map([[latest, {}]]),
        debugger: { log: () => undefined },
        clientVersionMap: new Map([
            ['old-page', 'previous'],
            ['current-page', latest],
        ]),
        fetchLatestManifest: async () => manifest,
        notifyClientsAboutNoNewVersionDetected: async () => undefined,
        completeOperation: async (_client, operation) => {
            completed.push(await operation);
        },
    });

    for (const id of ['old-page', 'current-page', 'untracked-page']) {
        await driver.handleMessage(
            { action: 'CHECK_FOR_UPDATES', nonce: 1 },
            { id }
        );
    }

    assert.deepEqual(completed, [true, false, false]);
    assert.equal(await driver.checkForUpdate(), false);

    driver.fetchLatestManifest = async () => null;
    const check = { action: 'CHECK_FOR_UPDATES', nonce: 2 };
    await driver.handleMessage(check, { id: 'old-page' });
    assert.equal(completed.at(-1), true);

    driver.state = context.States.EXISTING_CLIENTS_ONLY;
    await driver.handleMessage(check, { id: 'old-page' });
    assert.equal(completed.at(-1), false);
});

test('failure of the installed version still degrades the worker', async () => {
    const installed = {};
    const driver = Object.create(context.Driver.prototype);
    Object.assign(driver, {
        state: context.States.NORMAL,
        versions: new Map([['installed', installed]]),
        latestHash: 'installed',
    });
    await driver.versionFailed(installed, new Error('installed cache corrupt'));
    assert.equal(driver.state, context.States.EXISTING_CLIENTS_ONLY);
});
