import {
    closeElectronApp,
    expect,
    launchElectronApp,
    openSources,
    openSourceEditor,
    updateSourceDialog,
    saveSourceDialog,
    sourceRowByTitle,
    test,
} from './electron-test-fixtures';
import {
    addLiveFormatPortal,
    configureLiveFormat,
    expectLiveFormatPlaying,
    liveChannels,
    observeLiveFormatMedia,
} from './xtream-live-format.fixture';

for (const player of ['html5', 'artplayer'] as const) {
    test(`@electron @xtream Auto live format ${player}: failing segment to playable TS`, async ({
        dataDir,
    }) => {
        test.setTimeout(120_000);
        const app = await launchElectronApp(dataDir, {
            args: ['--autoplay-policy=no-user-gesture-required'],
        });
        try {
            const page = app.mainWindow;
            const media = observeLiveFormatMedia(page);
            await configureLiveFormat(page, player);
            await addLiveFormatPortal(page);
            await openSources(page);
            const dialog = await openSourceEditor(page, 'Synthetic live');
            await updateSourceDialog(dialog, {
                userAgent: 'IPTVnator-1513-fixture',
            });
            await saveSourceDialog(page, dialog);
            await sourceRowByTitle(page, 'Synthetic live').first().click();
            await page
                .getByRole('link', { name: 'Live TV', exact: true })
                .click();
            await page.locator('.context-panel .category-item').first().click();
            const [tsResponse] = await Promise.all([
                page.waitForResponse(
                    (response) => response.url().endsWith('/10000.ts'),
                    { timeout: 60_000 }
                ),
                liveChannels(page).first().click(),
                expectLiveFormatPlaying(page, player),
            ]);
            expect(await tsResponse.headerValue('x-fixture-user-agent')).toBe(
                'IPTVnator-1513-fixture'
            );

            expect(media).toContainEqual({ file: '10000.m3u8', status: 200 });
            expect(media).toContainEqual({
                file: 'denied-segment.ts',
                status: 403,
            });
            expect(media.filter((r) => r.file === '10000.ts')).toEqual([
                { file: '10000.ts', status: 200 },
            ]);
        } finally {
            await closeElectronApp(app);
        }
    });
}

test('@electron @xtream Video.js supports the manual TS workaround', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir, {
        args: ['--autoplay-policy=no-user-gesture-required'],
    });
    try {
        const page = app.mainWindow;
        const media = observeLiveFormatMedia(page);
        await configureLiveFormat(page, 'videojs', 'ts');
        await addLiveFormatPortal(page);
        await liveChannels(page).first().click();
        await expectLiveFormatPlaying(page, 'videojs');
        expect(media.some((r) => r.file.endsWith('.m3u8'))).toBe(false);
        expect(media.filter((r) => r.file === '10000.ts')).toHaveLength(1);
    } finally {
        await closeElectronApp(app);
    }
});
