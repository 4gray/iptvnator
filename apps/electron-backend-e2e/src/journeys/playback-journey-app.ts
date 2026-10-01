import type { ElectronApplication, Page } from '@playwright/test';

import { configureLiveFormat } from '../xtream-live-format.fixture';
import {
    JOURNEY_CLICK_QUIET_MS,
    waitForJourneyClickQuiet,
} from '../performance/journey-click-settle';
import {
    detachJourneyMainIpcCapture,
    installJourneyMainIpcCapture,
    JOURNEY_MAIN_IPC_STATE_KEY,
    JOURNEY_RENDERER_API_TRACE_CHANNEL,
    readJourneyMainIpcCapture,
} from '../performance/journey-main-ipc-capture';
import type { JourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import {
    armJourneyRendererProbe,
    createPlaybackJourneyProbeOptions,
    JOURNEY_OPEN_SOURCE_START_SELECTOR,
    waitForJourneyRendererProbe,
} from '../performance/journey-renderer-probe';
import {
    PLAYBACK_JOURNEY_AFTER_PLAYING_WINDOW_MS,
    type PlaybackJourneyMeasurement,
} from '../performance/playback-journey-record';
import type {
    LaunchJourneySeedOptions,
    LaunchJourneySession,
} from './launch-journey-app';

/**
 * J3 "Playback": runs inside a process that J1 has just launched. The test
 * opens the Xtream portal's live section and its first category (not
 * measured), lets the app settle like J2, then clicks the first live channel
 * and measures until the HTML5 player's video element fires `playing`.
 *
 * The portal is the mock's `live-fallback` account, whose `.ts` live URLs
 * serve a local six-second H.264 baseline + AAC MPEG-TS fixture
 * (`apps/xtream-mock-server/src/fixtures/live.mpegts`). The HTML5 player
 * plays it through mpegts.js and Media Source Extensions, which Electron's
 * Chromium supports on every platform. The marketing accounts' live URLs
 * serve zero-filled bytes that no player can decode, and the other accounts
 * redirect to a public HLS stream. Contract:
 * docs/architecture/performance-journeys.md.
 */
export const PLAYBACK_JOURNEY_MAIN_IPC_STATE_KEY =
    '__iptvnatorJourneyPlaybackMainIpcCapture';
export const PLAYBACK_JOURNEY_PORTAL_NAME = 'Journey live portal';
const ERROR_PREFIX = 'playback-journey';
const EXTERNAL_ARTWORK_STATE_KEY = '__iptvnatorJourneyExternalArtwork';
/**
 * The generated live catalog's channel and category logos point at
 * picsum.photos. They are cancelled in the main process, so no request of
 * the journey leaves the machine and a logo never loads, or fails, at a
 * different moment on a runner with a different network.
 */
const EXTERNAL_ARTWORK_URLS = ['*://picsum.photos/*', '*://*.picsum.photos/*'];

/** Seeds J2's profile with the local-media portal and the HTML5 player. */
export const PLAYBACK_JOURNEY_SEED: LaunchJourneySeedOptions = {
    // The built-in HTML5 player with the `ts` stream format: live URLs end
    // in `.ts`, which the mock serves from the local fixture.
    configure: (page) => configureLiveFormat(page, 'html5', 'ts'),
    portal: {
        name: PLAYBACK_JOURNEY_PORTAL_NAME,
        password: 'live-fallback',
        username: 'live-fallback',
    },
};

async function blockExternalArtwork(
    electronApp: ElectronApplication
): Promise<void> {
    await electronApp.evaluate(
        ({ session }, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            if (target[input.key] !== undefined) {
                throw new Error('playback-journey-artwork-block-installed');
            }
            const state = { cancelled: 0 };
            target[input.key] = state;
            // The app registers no onBeforeRequest listener of its own
            // (only onBeforeSendHeaders), so this replaces nothing.
            session.defaultSession.webRequest.onBeforeRequest(
                { urls: input.urls },
                (_details, callback) => {
                    state.cancelled += 1;
                    callback({ cancel: true });
                }
            );
        },
        { key: EXTERNAL_ARTWORK_STATE_KEY, urls: EXTERNAL_ARTWORK_URLS }
    );
}

async function readCancelledExternalArtwork(
    electronApp: ElectronApplication
): Promise<number> {
    return electronApp.evaluate(
        (_electron, key) =>
            (
                (globalThis as unknown as Record<string, unknown>)[key] as {
                    cancelled: number;
                }
            ).cancelled,
        EXTERNAL_ARTWORK_STATE_KEY
    );
}

/** Dashboard card → live section → first category, as a user would. */
async function openLiveCategory(page: Page, timeoutMs: number): Promise<void> {
    await page
        .locator(JOURNEY_OPEN_SOURCE_START_SELECTOR)
        .filter({ hasText: PLAYBACK_JOURNEY_PORTAL_NAME })
        .first()
        .click({ timeout: timeoutMs });
    await page.waitForURL(/\/workspace\/xtreams\/[^/]+\/vod/, {
        timeout: timeoutMs,
    });
    await page
        .getByRole('link', { name: 'Live TV', exact: true })
        .click({ timeout: timeoutMs });
    await page
        .locator('app-workspace-context-panel .category-item')
        .first()
        .click({ timeout: timeoutMs });
}

/**
 * `spawnLedgerMark` is the ledger position taken before the process was
 * spawned, so the launch's and the navigation's mock traffic is kept as
 * evidence.
 */
export async function measurePlaybackJourney(
    session: LaunchJourneySession,
    ledger: JourneyMockRequestLedger,
    spawnLedgerMark: number,
    timeoutMs: number
): Promise<PlaybackJourneyMeasurement> {
    const { electronApp, mainWindow } = session;
    const probeOptions = createPlaybackJourneyProbeOptions();
    const startClick = probeOptions.startClick;
    if (!startClick) {
        throw new Error('playback-journey-probe-without-start');
    }
    await blockExternalArtwork(electronApp);
    await openLiveCategory(mainWindow, timeoutMs);
    const channel = mainWindow.locator(startClick.selector).first();
    await channel.waitFor({ state: 'visible', timeout: timeoutMs });
    await installJourneyMainIpcCapture(electronApp, {
        channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
        sentinelId: probeOptions.sentinelId,
        sentinelMethod: probeOptions.sentinelMethod,
        startSentinelId: startClick.sentinelId,
        stateKey: PLAYBACK_JOURNEY_MAIN_IPC_STATE_KEY,
    });
    await armJourneyRendererProbe(mainWindow, probeOptions);
    // Hover first so hover effects happen before the app settles.
    await channel.hover({ timeout: timeoutMs });
    const { ledgerMark: settledLedgerMark, settle } =
        await waitForJourneyClickQuiet(electronApp, mainWindow, ledger, {
            errorPrefix: ERROR_PREFIX,
            ipcCaptureStateKey: PLAYBACK_JOURNEY_MAIN_IPC_STATE_KEY,
            probeStateKey: probeOptions.stateKey,
        });
    await detachJourneyMainIpcCapture(electronApp, JOURNEY_MAIN_IPC_STATE_KEY);
    await channel.click({ timeout: timeoutMs });
    const renderer = await waitForJourneyRendererProbe(
        mainWindow,
        probeOptions.stateKey,
        timeoutMs
    );
    const ipc = await readJourneyMainIpcCapture(
        electronApp,
        PLAYBACK_JOURNEY_MAIN_IPC_STATE_KEY,
        10_000
    );
    const clickEpochMs = renderer.start?.epochMs;
    const playingEpochMs = renderer.terminal?.epochMs;
    if (clickEpochMs === undefined || playingEpochMs === undefined) {
        throw new Error('playback-journey-probe-incomplete');
    }
    // A live stream never leaves the mock quiet, so instead of J2's quiet
    // wait the ledger is watched for a fixed window after `playing`.
    const afterPlayingUntilEpochMs =
        playingEpochMs + PLAYBACK_JOURNEY_AFTER_PLAYING_WINDOW_MS;
    const remainingMs =
        afterPlayingUntilEpochMs - (performance.timeOrigin + performance.now());
    if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
    }
    // The ledger stamps arrivals with this process's clock, the probe with
    // the renderer's; both read the same host clock (as in J2). The record
    // keeps the distance of the nearest request to each boundary, so a
    // count that a small clock difference could flip is visible.
    const sinceSpawn = ledger.since(spawnLedgerMark);
    const beforeClick = sinceSpawn.filter(
        (entry) => entry.epochMs < clickEpochMs
    );
    return {
        externalArtworkCancelled:
            await readCancelledExternalArtwork(electronApp),
        http: {
            afterPlaying: sinceSpawn.filter(
                (entry) =>
                    entry.epochMs >= playingEpochMs &&
                    entry.epochMs < afterPlayingUntilEpochMs
            ),
            afterSettleBeforeClick: beforeClick.filter(
                (entry) => entry.sequence >= settledLedgerMark
            ).length,
            beforeClick,
            toPlaying: sinceSpawn.filter(
                (entry) =>
                    entry.epochMs >= clickEpochMs &&
                    entry.epochMs < playingEpochMs
            ),
        },
        ipc,
        pid: session.launch.pid,
        renderer,
        settle,
    };
}
