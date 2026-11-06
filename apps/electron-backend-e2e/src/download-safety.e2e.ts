import { workspaceRoot } from '@nx/devkit';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

test('@downloads @electron rejects executable downloads and never opens legacy executable rows', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const directory = join(dataDir, 'download-safety');
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, 'Legacy movie.cmd');
    writeFileSync(filePath, 'inert download safety fixture');
    try {
        await app.electronApp.evaluate(({ dialog }, folder) => {
            dialog.showOpenDialog = async () => ({
                canceled: false,
                filePaths: [folder],
            });
        }, directory);
        await app.mainWindow.evaluate(() =>
            window.electron.downloadsSelectFolder()
        );
        const startError = await app.mainWindow.evaluate(async (folder) => {
            try {
                await window.electron.downloadsStart({
                    playlistId: 'download-safety',
                    xtreamId: 1,
                    contentType: 'vod',
                    title: 'Untrusted movie',
                    url: 'http://127.0.0.1:1/movie.cmd',
                    downloadFolder: folder,
                });
                return null;
            } catch (error) {
                return String(error);
            }
        }, directory);
        expect(startError).toContain('Unsupported download media type');

        await app.electronApp.evaluate(
            ({ shell }, options) => {
                const Database = process
                    .getBuiltinModule('module')
                    .createRequire(options.dependency)(options.dependency);
                const db = new Database(options.database);
                try {
                    db.prepare(
                        `INSERT INTO downloads
                    (playlist_id, xtream_id, content_type, title, url, file_name, file_path, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                    ).run(
                        'download-safety',
                        2,
                        'vod',
                        'Legacy movie',
                        'https://provider.test/movie.cmd',
                        'Legacy movie.cmd',
                        options.filePath,
                        'completed'
                    );
                } finally {
                    db.close();
                }
                // Fail safely even if a later regression reaches the OS boundary.
                shell.openPath = async () => 'OS opening must not be reached';
            },
            {
                dependency: join(workspaceRoot, 'node_modules/better-sqlite3'),
                database: join(dataDir, 'databases/iptvnator.db'),
                filePath,
            }
        );
        await expect(
            app.mainWindow.evaluate(
                (file) => window.electron.downloadsPlayFile(file),
                filePath
            )
        ).resolves.toEqual({
            success: false,
            error: 'Unsupported download media type',
        });
        const row = await app.mainWindow.evaluate(
            async (file) =>
                (await window.electron.downloadsGetList()).find(
                    (item) => item.filePath === file
                ),
            filePath
        );
        expect(row?.status).toBe('completed');
    } finally {
        await closeElectronApp(app);
    }
});
