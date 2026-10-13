import type { APIRequestContext, Page } from '@playwright/test';
import {
    addXtreamPortal,
    clickCategoryByNameExact,
    clickGridListCardByTitle,
    closeElectronApp,
    expect,
    goToDashboard,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    resetMockServers,
    saveSettings,
    test,
    waitForXtreamImportToFinish,
    xtreamMockServer,
} from './electron-test-fixtures';
import { installEmbeddedMpvSessionCapture } from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    fetchXtreamSeriesFixture,
    getXtreamTitle,
} from './portal-mock-fixtures';

/**
 * Issue #1902: an episode whose connection drops reaches mpv as EOF in the
 * middle of the episode, and series autoplay used to take that for the end
 * and start the next episode. The `streamdrop` mock cuts every episode a
 * third of the way into its 60 s clip and refuses it for a few seconds, so
 * ffmpeg's own reconnect fails and only the app-level reconnect can resume.
 * Needs the native-view Embedded MPV runtime; skips where it is missing.
 */
const credentials = { password: 'streamdrop', username: 'streamdrop' };
/** Past the ~21 s cut: the resumed episode has played on. */
const RESUMED_POSITION_SECONDS = 25;
/** Keyframe rounding and the 500 ms poll before the drop. */
const RESUME_TOLERANCE_SECONDS = 3;

type SessionSample = {
    episodeId: number | null;
    positionSeconds: number;
    reconnecting: boolean;
    status: string;
};

async function fetchSeasonOneEpisodeIds(
    request: APIRequestContext,
    seriesId: number
): Promise<number[]> {
    const params = new URLSearchParams({
        action: 'get_series_info',
        series_id: String(seriesId),
        ...credentials,
    });
    const response = await request.get(
        `${xtreamMockServer}/player_api.php?${params}`
    );
    expect(response.ok()).toBeTruthy();
    const info = (await response.json()) as {
        episodes?: Record<string, { id: string; episode_num: number }[]>;
    };
    return [...(info.episodes?.['1'] ?? [])]
        .sort((a, b) => a.episode_num - b.episode_num)
        .map((episode) => Number(episode.id));
}

/**
 * Session updates in arrival order, each tagged with the episode its session
 * last loaded: the `loading` update carries the requested URL, while later
 * snapshots report mpv's `path`, which not every engine fills in reliably.
 */
function readSessions(page: Page): Promise<SessionSample[]> {
    return page.evaluate(() => {
        const episodeBySession = new Map<string, number>();
        return (window.__packagedEmbeddedMpvSessions ?? []).map((session) => {
            const match = /\/series\/[^/]+\/[^/]+\/(\d+)\.\w+$/.exec(
                session.streamUrl
            );
            if (match) {
                episodeBySession.set(session.id, Number(match[1]));
            }
            return {
                episodeId: episodeBySession.get(session.id) ?? null,
                positionSeconds: session.positionSeconds,
                reconnecting: !!session.reconnect,
                status: session.status,
            };
        });
    });
}

/**
 * What followed the first episode's mid-episode EOF, in update order. Every
 * position played after the drop must stay near the drop: a reload that
 * restarted the episode would otherwise reach the resumed position as well.
 * A zero is the engine's placeholder before the reload's first `time-pos`.
 */
function outcomeAfterDrop(
    sessions: SessionSample[],
    [first, second]: number[]
): 'pending' | 'resumed' | 'restarted' | 'skipped' {
    const dropped = sessions.findIndex(
        (session) => session.episodeId === first && session.status === 'ended'
    );
    if (dropped < 0) {
        return 'pending';
    }
    const dropPosition = sessions[dropped].positionSeconds;
    for (const session of sessions.slice(dropped)) {
        if (session.episodeId === second) {
            return 'skipped';
        }
        if (session.episodeId !== first || session.status !== 'playing') {
            continue;
        }
        if (
            session.positionSeconds > 0 &&
            session.positionSeconds < dropPosition - RESUME_TOLERANCE_SECONDS
        ) {
            return 'restarted';
        }
        if (session.positionSeconds >= RESUMED_POSITION_SECONDS) {
            return 'resumed';
        }
    }
    return 'pending';
}

test('@playback @xtream @electron @embedded-mpv resumes an episode whose connection drops instead of skipping to the next one', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(180_000);
    await resetMockServers(request, ['xtream']);
    const fixture = await fetchXtreamSeriesFixture(request, credentials);
    const series = fixture.items[0];
    if (!series) {
        throw new Error('The stream-drop scenario has no series.');
    }
    const episodeIds = await fetchSeasonOneEpisodeIds(
        request,
        Number(series.series_id)
    );
    expect(episodeIds).toHaveLength(3);

    const app = await launchElectronApp(dataDir, {
        env: {
            IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1',
            IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: '0',
            IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW: '1',
        },
    });
    try {
        const support = await app.mainWindow.evaluate(() =>
            window.electron.getEmbeddedMpvSupport()
        );
        test.skip(
            !support.supported || support.engine !== 'native',
            `Native-view Embedded MPV unavailable: ${JSON.stringify(support)}`
        );
        await openSettings(app.mainWindow);
        await openSettingsSection(app.mainWindow, 'playback');
        await app.mainWindow.getByTestId('select-video-player').click();
        await app.mainWindow.getByTestId('embedded-mpv').click();
        await saveSettings(app.mainWindow);
        await goToDashboard(app.mainWindow);

        await addXtreamPortal(app.mainWindow, {
            ...credentials,
            name: 'Stream Drop',
        });
        await waitForXtreamImportToFinish(app.mainWindow);
        await installEmbeddedMpvSessionCapture(app);
        await openWorkspaceSection(app.mainWindow, 'Series');
        await clickCategoryByNameExact(app.mainWindow, fixture.categoryName);
        await clickGridListCardByTitle(app.mainWindow, getXtreamTitle(series));
        const episode = app.mainWindow
            .locator('.episode-card, .episode-list-item')
            .first();
        await expect(episode).toBeVisible({ timeout: 20_000 });
        await episode.click();

        await expect
            .poll(
                async () =>
                    outcomeAfterDrop(
                        await readSessions(app.mainWindow),
                        episodeIds
                    ),
                { timeout: 90_000 }
            )
            .not.toBe('pending');
        const sessions = await readSessions(app.mainWindow);
        expect(outcomeAfterDrop(sessions, episodeIds)).toBe('resumed');
        // The drop was shown as a reconnect, not as the episode's end.
        expect(sessions.some((session) => session.reconnecting)).toBe(true);
    } finally {
        await closeElectronApp(app);
    }
});
