import { createServer, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

function feed(title: string, count = 1): string {
    const date = (offset: number) =>
        new Date(Date.now() + offset)
            .toISOString()
            .replace(/[-:T]/g, '')
            .slice(0, 14) + ' +0000';
    return (
        '<tv><channel id="atomic"><display-name>' +
        title +
        '</display-name></channel>' +
        Array.from(
            { length: count },
            (_, index) =>
                `<programme channel="atomic" start="${date(-60000)}" stop="${date(3600000)}"><title>${title} ${index}</title></programme>`
        ).join('') +
        '</tv>'
    );
}

for (const failure of ['xml', 'gzip', 'remove'] as const) {
    test(`@epg @electron preserves the live guide during staging and handles ${failure} without false completion`, async ({
        dataDir,
    }) => {
        let mode: 'seed' | 'failure' | 'retry' = 'seed';
        let held: ServerResponse | undefined;
        const server = createServer((request, response) => {
            const other = request.url === '/other.xml';
            if (other || mode === 'seed') {
                response.end(feed(other ? 'Other' : 'Previous'));
            } else if (mode === 'retry') {
                response.end(feed('Replacement'));
            } else {
                const xml = feed('Unpublished', 1001);
                if (failure === 'gzip') {
                    response.writeHead(200, {
                        'Content-Type': 'application/gzip',
                    });
                    const compressed = gzipSync(xml);
                    response.end(compressed.subarray(0, compressed.length - 8));
                } else {
                    response.writeHead(200, {
                        'Content-Type': 'application/xml',
                    });
                    response.write(xml.replace('</tv>', ''));
                    held = response;
                }
            }
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('No fixture port');
        const source = `http://127.0.0.1:${address.port}/guide.xml`;
        const otherSource = `http://127.0.0.1:${address.port}/other.xml`;
        const app = await launchElectronApp(dataDir);
        let pending: Promise<unknown> | undefined;
        try {
            for (const url of [source, otherSource]) {
                expect(
                    await app.mainWindow.evaluate(
                        (value) => window.electron.forceFetchEpg(value),
                        url
                    )
                ).toMatchObject({ success: true });
            }
            const titles = () =>
                app.mainWindow.evaluate(async () =>
                    (await window.electron.getChannelPrograms('atomic'))
                        .map((p) => p.title)
                        .sort()
                );
            expect(await titles()).toEqual(['Other 0', 'Previous 0']);
            await app.mainWindow.evaluate((url) => {
                document.documentElement.dataset['importStats'] = '0';
                document.documentElement.dataset['importStatus'] = '';
                window.electron.onEpgProgress?.((progress) => {
                    if (progress.url !== url) return;
                    document.documentElement.dataset['importStatus'] =
                        progress.status;
                    if (progress.stats)
                        document.documentElement.dataset['importStats'] =
                            String(progress.stats.totalPrograms);
                });
            }, source);
            mode = 'failure';
            pending = app.mainWindow.evaluate(
                (url) => window.electron.forceFetchEpg(url),
                source
            );
            void pending.catch(() => undefined);
            if (failure !== 'gzip') {
                await expect
                    .poll(() =>
                        app.mainWindow.evaluate(() =>
                            Number(
                                document.documentElement.dataset['importStats']
                            )
                        )
                    )
                    .toBeGreaterThanOrEqual(1000);
                expect(await titles()).toEqual(['Other 0', 'Previous 0']);
                if (failure === 'remove') {
                    expect(
                        await app.mainWindow.evaluate(
                            (url) => window.electron.clearEpgDataForSource(url),
                            source
                        )
                    ).toMatchObject({ success: true });
                } else {
                    expect(held).toBeDefined();
                    held?.end('<broken></tv>');
                }
            }
            const result = await pending;
            if (failure !== 'remove')
                expect(result).toMatchObject({ success: false });
            expect(
                await app.mainWindow.evaluate(
                    () => document.documentElement.dataset['importStatus']
                )
            ).toBe(failure === 'remove' ? 'cancelled' : 'error');
            expect(await titles()).toEqual(
                failure === 'remove' ? ['Other 0'] : ['Other 0', 'Previous 0']
            );
            mode = 'retry';
            expect(
                await app.mainWindow.evaluate(
                    (url) => window.electron.forceFetchEpg(url),
                    source
                )
            ).toMatchObject({ success: true });
            expect(await titles()).toEqual(['Other 0', 'Replacement 0']);
        } finally {
            held?.destroy();
            await pending?.catch(() => undefined);
            await closeElectronApp(app);
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
}
