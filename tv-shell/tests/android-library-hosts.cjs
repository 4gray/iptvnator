// Electron fixture for android-library-connections.mjs. The workers and their private
// administrative transport are the same ones started by the desktop app.
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');

const workers = new Map();
app.dock?.hide();

app.whenReady()
    .then(async () => {
        for (const [name, port] of JSON.parse(
            process.env.ANDROID_FIXTURE_HOSTS
        )) {
            const worker = utilityProcess.fork(
                join(process.cwd(), 'dist/apps/web-backend/main.cjs'),
                [],
                {
                    serviceName: 'Synthetic Android library',
                    env: {
                        ...process.env,
                        PORT: String(port),
                        IPTVNATOR_STORAGE: 'server',
                        IPTVNATOR_DATA_DIR: join(app.getPath('userData'), name),
                        IPTVNATOR_E2E_DATA_DIR: '',
                        IPTVNATOR_SOURCE_PROFILE: '',
                        IPTVNATOR_ACCESS_TOKEN: 'synthetic-android-owner',
                        IPTVNATOR_HOSTED_ASSETS:
                            process.env.ANDROID_FIXTURE_ASSETS,
                        IPTVNATOR_HOSTED_MODE: JSON.stringify({
                            mode: 'lan',
                            address: '',
                        }),
                    },
                }
            );
            workers.set(name, worker);
            const pending = new Map();
            let sequence = 0;
            const request = (method, path, body, headers = {}) =>
                new Promise((resolve, reject) => {
                    const requestId = String(++sequence);
                    const timer = setTimeout(() => {
                        pending.delete(requestId);
                        reject(new Error('Hosted worker request timed out'));
                    }, 15000);
                    pending.set(requestId, (response) => {
                        clearTimeout(timer);
                        resolve(response);
                    });
                    worker.postMessage({
                        requestId,
                        workerRequest: { method, path, body, headers },
                    });
                });
            await new Promise((resolve, reject) => {
                worker.once('message', (message) =>
                    message.ready
                        ? resolve()
                        : reject(new Error('Fixture worker failed'))
                );
                worker.once('exit', () =>
                    reject(new Error('Fixture worker exited'))
                );
            });
            worker.on('message', ({ reply, response }) => {
                pending.get(reply)?.(response);
                pending.delete(reply);
            });
            const id = 'synthetic-' + name;
            const result = await request(
                'PUT',
                '/v1/sources/' + id,
                {
                    id,
                    kind: 'm3u-text',
                    title: 'Synthetic hosted ' + name,
                    rawM3u: '#EXTM3U\n#EXTINF:-1,Synthetic clip\nhttps://streams.example.test/clip.webm',
                },
                { 'If-None-Match': '*' }
            );
            if (result.status !== 201)
                throw new Error('Failed to seed synthetic source');
            worker.request = request;
        }
        globalThis.androidFixture = {
            async approve(name, code) {
                const request = workers.get(name).request;
                const { body } = await request('GET', '/v1/devices');
                const claim = body.pending.find(
                    (entry) => entry.confirmationCode === code
                );
                if (!claim)
                    throw new Error(
                        'Android code did not match the desktop claim'
                    );
                const reply = await request(
                    'POST',
                    '/v1/device-pairing/approve',
                    { claimId: claim.claimId }
                );
                return reply.status;
            },
        };
    })
    .catch((error) => {
        console.error(error.message);
        app.exit(1);
    });

app.on('will-quit', () => {
    for (const worker of workers.values()) worker.kill();
});
