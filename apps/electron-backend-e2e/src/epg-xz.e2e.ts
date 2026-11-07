import { copyFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
    workspaceRoot,
} from './electron-test-fixtures';

const fixturePath = join(
    workspaceRoot,
    'apps/electron-backend/src/app/workers/testing/fixtures/guide.xml.xz'
);

test('@epg @electron picks and imports a local XZ guide', async ({
    dataDir,
}) => {
    const file = join(dataDir, 'synthetic guide.xml.xz');
    copyFileSync(fixturePath, file);
    const app = await launchElectronApp(dataDir);
    try {
        await app.electronApp.evaluate(({ dialog }, filePath) => {
            dialog.showOpenDialog = (async (
                options: Electron.OpenDialogOptions
            ) => {
                if (
                    !options.filters
                        ?.find((filter) => filter.name === 'XMLTV')
                        ?.extensions.includes('xz')
                )
                    throw new Error(
                        'XZ is missing from the XMLTV picker filter'
                    );
                return { canceled: false, filePaths: [filePath] };
            }) as typeof dialog.showOpenDialog;
            dialog.showMessageBox = (async () => {
                throw new Error(
                    'Picker-authorized files must not prompt again'
                );
            }) as typeof dialog.showMessageBox;
        }, file);
        expect(
            await app.mainWindow.evaluate(() =>
                window.electron.openEpgFileDialog()
            )
        ).toBe(file);
        expect(
            await app.mainWindow.evaluate(
                (source) => window.electron.forceFetchEpg(source),
                file
            )
        ).toMatchObject({ success: true });
        expect(
            await app.mainWindow.evaluate(() =>
                window.electron.getChannelPrograms('test')
            )
        ).toEqual([expect.objectContaining({ title: 'Test Bulletin' })]);
    } finally {
        await closeElectronApp(app);
    }
});

test('@epg @electron imports HTTP gzip over XZ and preserves the guide after a truncated refresh', async ({
    dataDir,
}) => {
    const fixture = readFileSync(fixturePath);
    let truncated = false;
    const server = createServer((_request, response) => {
        response.writeHead(200, {
            'Content-Type': 'application/x-xz',
            'Content-Encoding': 'gzip',
        });
        response.end(gzipSync(truncated ? fixture.subarray(0, -4) : fixture));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address() as AddressInfo;
    const source = `http://127.0.0.1:${address.port}/guide.xml.xz`;
    try {
        const app = await launchElectronApp(dataDir);
        try {
            const refresh = () =>
                app.mainWindow.evaluate(
                    (url) => window.electron.forceFetchEpg(url),
                    source
                );
            expect(await refresh()).toMatchObject({ success: true });
            const programmes = () =>
                app.mainWindow.evaluate(() =>
                    window.electron.getChannelPrograms('test')
                );
            const before = await programmes();
            expect(before).toEqual([
                expect.objectContaining({ title: 'Test Bulletin' }),
            ]);
            truncated = true;
            expect(await refresh()).toMatchObject({ success: false });
            expect(await programmes()).toEqual(before);
            truncated = false;
            expect(await refresh()).toMatchObject({ success: true });
        } finally {
            await closeElectronApp(app);
        }
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
