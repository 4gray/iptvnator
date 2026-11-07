import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
    addXtreamPortal,
    channelItemByTitle,
    clickCategoryByNameExact,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    saveSettings,
    test,
    workspaceRoot,
} from './electron-test-fixtures';
import { installEmbeddedMpvSessionCapture } from './embedded-mpv-frame-copy-packaged-fixtures';

for (const engine of ['native', 'frame-copy'] as const) {
    test(`@playback @electron @embedded-mpv ${engine} keeps subtitles off while switching live channels`, async ({
        dataDir,
    }) => {
        const frameCopy = engine === 'frame-copy';
        // Tracked synthetic Matroska fixture with a default and an alternate SRT track.
        const media = readFileSync(
            join(
                workspaceRoot,
                'apps/electron-backend-e2e/src/fixtures/live-subtitles.mkv'
            )
        );
        const channelNames = ['Subtitle fixture A', 'Subtitle fixture B'];
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            const stream = /^\/live\/[^/]+\/[^/]+\/(101|102)\.\w+$/.exec(
                url.pathname
            );
            if (stream) {
                response
                    .writeHead(200, {
                        'Content-Type': 'video/x-matroska',
                        'Content-Length': media.length,
                    })
                    .end(request.method === 'HEAD' ? undefined : media);
                return;
            }
            if (url.pathname !== '/player_api.php') {
                response.writeHead(404).end();
                return;
            }
            const actions: Record<string, unknown> = {
                get_live_categories: [
                    {
                        category_id: '1',
                        category_name: 'Subtitle fixtures',
                        parent_id: 0,
                    },
                ],
                get_live_streams: channelNames.map((name, index) => ({
                    num: index + 1,
                    name,
                    stream_type: 'live',
                    stream_id: 101 + index,
                    category_id: '1',
                    stream_icon: '',
                    epg_channel_id: `fixture-${index}`,
                    added: '1700000000',
                    tv_archive: 0,
                    tv_archive_duration: 0,
                })),
                get_short_epg: { epg_listings: [] },
                get_simple_data_table: { epg_listings: [] },
            };
            const account = {
                user_info: {
                    username: 'demo',
                    password: 'demo',
                    auth: 1,
                    status: 'Active',
                    allowed_output_formats: ['ts'],
                    max_connections: '2',
                    active_cons: '0',
                },
                server_info: { server_protocol: 'http', timezone: 'UTC' },
            };
            const action = url.searchParams.get('action') ?? '';
            response
                .writeHead(200, { 'Content-Type': 'application/json' })
                .end(
                    JSON.stringify(
                        !action || action === 'get_account_info'
                            ? account
                            : (actions[action] ?? [])
                    )
                );
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Fixture address unavailable');
        let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
        try {
            app = await launchElectronApp(dataDir, {
                env: {
                    IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
                    IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: frameCopy
                        ? '1'
                        : '0',
                    IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
                },
            });
            const page = app.mainWindow;
            const support = await page.evaluate(() =>
                window.electron.getEmbeddedMpvSupport()
            );
            test.skip(
                !support.supported ||
                    support.engine !== engine ||
                    !support.capabilities?.subtitles,
                `Embedded MPV ${engine} subtitles unavailable on this runtime`
            );
            await openSettings(page);
            await openSettingsSection(page, 'playback');
            await page.getByTestId('select-video-player').click();
            await page.getByTestId('embedded-mpv').click();
            await saveSettings(page);
            await goToDashboard(page);
            await installEmbeddedMpvSessionCapture(app);
            await addXtreamPortal(page, {
                name: 'Synthetic subtitle portal',
                serverUrl: `http://127.0.0.1:${address.port}`,
                username: 'demo',
                password: 'demo',
                contentTypes: ['live'],
            });
            await openWorkspaceSection(page, 'Live TV');
            await clickCategoryByNameExact(page, 'Subtitle fixtures');
            const snapshot = (title: string, previousId?: string) =>
                page.evaluate(
                    ({ title, previousId }) => {
                        const session = window.__packagedEmbeddedMpvSessions
                            ?.slice()
                            .reverse()
                            .find(
                                (candidate) =>
                                    candidate.title === title &&
                                    candidate.id !== previousId &&
                                    candidate.status === 'playing' &&
                                    candidate.positionSeconds >= 1 &&
                                    candidate.subtitleTracks.length > 0
                            );
                        return (
                            session && {
                                id: session.id,
                                trackCount: session.subtitleTracks.length,
                                selected: session.selectedSubtitleTrackId,
                            }
                        );
                    },
                    { title, previousId }
                );
            const retry = page
                .locator('.embedded-mpv-player__stalled')
                .getByRole('button', { name: 'Retry' });
            const waitForTracks = (title: string) =>
                expect(async () => {
                    if (await retry.isVisible()) await retry.click();
                    expect((await snapshot(title))?.trackCount).toBe(2);
                }).toPass({ timeout: 25000 });
            await channelItemByTitle(page, channelNames[0]).first().click();
            await waitForTracks(channelNames[0]);
            await expect
                .poll(async () => (await snapshot(channelNames[0]))?.selected)
                .toBe(1);
            const first = await snapshot(channelNames[0]);
            const selectSubtitle = async (name: string) => {
                await page.locator('app-embedded-mpv-player').hover();
                if (frameCopy) {
                    await page
                        .getByTestId('player-controls-settings-button')
                        .click();
                    await page
                        .getByTestId('player-settings-subtitles')
                        .getByRole('radio', { name, exact: true })
                        .click();
                } else {
                    await page
                        .locator('[data-embedded-mpv-menu-button="subtitle"]')
                        .click();
                    await page
                        .getByRole('menuitemradio', { name, exact: true })
                        .click();
                }
            };

            await selectSubtitle('Off');
            await expect
                .poll(async () => (await snapshot(channelNames[0]))?.selected)
                .toBeNull();
            await channelItemByTitle(page, channelNames[1]).first().click();
            await waitForTracks(channelNames[1]);
            const second = await snapshot(channelNames[1]);
            expect(second?.id).not.toBe(first?.id);
            await expect
                .poll(async () => (await snapshot(channelNames[1]))?.selected, {
                    timeout: 3500,
                })
                .toBeNull();

            await selectSubtitle('Alternate cue');
            await expect
                .poll(async () => (await snapshot(channelNames[1]))?.selected)
                .toBe(2);
            await channelItemByTitle(page, channelNames[0]).first().click();
            await expect
                .poll(
                    async () =>
                        (await snapshot(channelNames[0], first?.id))?.selected
                )
                .toBe(1);
        } finally {
            try {
                if (app) await closeElectronApp(app);
            } finally {
                server.closeAllConnections();
                await new Promise<void>((resolve) =>
                    server.close(() => resolve())
                );
            }
        }
    });
}
