import assert from 'node:assert/strict';
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
