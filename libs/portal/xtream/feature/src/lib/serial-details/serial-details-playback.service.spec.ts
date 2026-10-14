import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type {
    ExternalPlayerSession,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    SerialDetailsPlaybackService,
    type XtreamSerieDetailsView,
} from './serial-details-playback.service';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import { SerialDetailsSeasonWatchService } from './serial-details-season-watch.service';

function episode(id: number): XtreamSerieEpisode {
    return {
        id: String(id),
        season: 1,
        episode_num: id - 1000,
        title: `Episode ${id - 1000}`,
    } as XtreamSerieEpisode;
}

function seriesView(seriesId: number): XtreamSerieDetailsView {
    return {
        series_id: seriesId,
        info: {},
        episodes: { '1': [episode(1001), episode(1002)] },
    } as unknown as XtreamSerieDetailsView;
}

const opened = {
    id: 'mpv-1',
    player: 'mpv',
    status: 'opened',
} as ExternalPlayerSession;

/** The series on screen; the component feeds it from the store. */
const selectedItem = signal<XtreamSerieDetailsView | null>(null);
const isEmbeddedPlayer = jest.fn();
const openResolvedPlayback = jest.fn();
const openExternalPlayback = jest.fn();
const savePlaybackPosition = jest.fn();

beforeEach(() => {
    jest.resetAllMocks();
    selectedItem.set(seriesView(103));
    isEmbeddedPlayer.mockReturnValue(false);
    openResolvedPlayback.mockResolvedValue(undefined);
    openExternalPlayback.mockResolvedValue(undefined);
    savePlaybackPosition.mockResolvedValue(undefined);
});

/** A fresh page: the component provides the service, so each visit gets its own instance. */
function createPage(): SerialDetailsPlaybackService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            SerialDetailsPlaybackService,
            {
                provide: ActivatedRoute,
                useValue: { snapshot: { params: { serialId: '103' } } },
            },
            {
                provide: XtreamStore,
                useValue: {
                    currentPlaylist: signal({ id: 'xtream-1' }),
                    constructEpisodeStreamUrl: (item: XtreamSerieEpisode) =>
                        `http://xtream.example/series/${item.id}.mp4`,
                },
            },
            {
                provide: PORTAL_PLAYBACK_POSITIONS,
                useValue: { savePlaybackPosition },
            },
            {
                provide: PORTAL_PLAYER,
                useValue: {
                    isEmbeddedPlayer,
                    openResolvedPlayback,
                    openExternalPlayback,
                },
            },
            {
                provide: PORTAL_EXTERNAL_PLAYBACK,
                useValue: { activeSession: signal(null) },
            },
            {
                provide: PlaybackPositionRuntimeBridgeService,
                useValue: { onPlaybackPositionUpdate: () => undefined },
            },
            { provide: PlaybackHistoryGate, useValue: { defer: jest.fn() } },
            { provide: XTREAM_SERIES_RESUME_TARGET, useValue: signal(null) },
            {
                provide: SerialDetailsSeasonWatchService,
                useValue: { batchRunning: signal(false) },
            },
        ],
    });
    const service = TestBed.inject(SerialDetailsPlaybackService);
    service.bind({ selectedItem });
    return service;
}

/** Lets the launch chain and the launch bookkeeping run their microtasks. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

/** Launches a test may have left open; see the `afterEach`. */
const heldLaunches: Array<() => void> = [];

/** Keeps the next launch through `open` unsettled until the returned function is called. */
function holdLaunch(
    open: jest.Mock
): (session?: ExternalPlayerSession) => void {
    let settle!: (session?: ExternalPlayerSession) => void;
    open.mockReturnValueOnce(
        new Promise<ExternalPlayerSession | void>(
            (resolve) => (settle = resolve)
        )
    );
    heldLaunches.push(() => settle());
    return settle;
}

// The launch chain is module state: a launch a failed test left open would
// keep the owner pending and hold up every later test's launch.
afterEach(async () => {
    heldLaunches.splice(0).forEach((release) => release());
    await flush();
});

describe('SerialDetailsPlaybackService page token', () => {
    it('gives a recreated page of the same series a token of its own', () => {
        const first = createPage();
        const firstOwner = first.launchOwner();
        const firstToken = first.pageToken();

        const reopened = createPage();

        expect(reopened.launchOwner()).toBe(firstOwner);
        expect(reopened.pageToken()).not.toBe(firstToken);
    });

    it('changes the token when the page moves on to another series', () => {
        const page = createPage();
        const token = page.pageToken();

        page.resetForNewSeries();

        expect(page.launchOwner()).toBe('xtream-1:103');
        expect(page.pageToken()).not.toBe(token);
    });
});

describe('SerialDetailsPlaybackService start during a forced launch', () => {
    it('queues a regular start until the forced launch settled', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        const page = createPage();
        const settleLaunch = holdLaunch(openExternalPlayback);
        const forced = page.playEpisode(episode(1001), 'mpv');
        expect(page.forcedLaunchPending()).toBe(true);

        // Play pressed while MPV still opens: the inline player must not
        // start beside it.
        page.playEpisode(episode(1002));
        await flush();
        expect(page.inlinePlayback()).toBeNull();

        settleLaunch(opened);
        await forced;
        await flush();
        expect(page.forcedLaunchPending()).toBe(false);
        expect(page.inlinePlayback()?.contentInfo?.contentXtreamId).toBe(1002);
    });

    it('sends a forced start down the launch chain, not into the queue', async () => {
        isEmbeddedPlayer.mockReturnValue(true);
        const page = createPage();
        const settleLaunch = holdLaunch(openExternalPlayback);
        const first = page.playEpisode(episode(1001), 'mpv');
        const second = page.playEpisode(episode(1002), 'vlc');
        await flush();
        expect(openExternalPlayback).toHaveBeenCalledTimes(1);

        settleLaunch(opened);
        await first;
        await second;
        await flush();
        // A queued choice replays as a regular start: it would lose its
        // player and open inline.
        expect(openExternalPlayback).toHaveBeenLastCalledWith(
            expect.objectContaining({
                contentInfo: expect.objectContaining({ contentXtreamId: 1002 }),
            }),
            'vlc'
        );
        expect(page.inlinePlayback()).toBeNull();
    });
});

describe('SerialDetailsPlaybackService launch position', () => {
    it('records the launch position once a forced launch settles on the same visit', async () => {
        const page = createPage();
        openExternalPlayback.mockResolvedValue(opened);

        await page.playEpisode(episode(1002), 'mpv');
        await flush();

        expect(savePlaybackPosition).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                contentXtreamId: 1002,
                contentType: 'episode',
                seriesXtreamId: 103,
                positionSeconds: 0,
            })
        );
        expect(page.episodePlaybackPositions().get(1002)?.positionSeconds).toBe(
            0
        );
    });

    it('skips the launch position once the page moved on to another series', async () => {
        const page = createPage();
        // The configured external player launches outside the forced
        // chain: nothing but the page token notices the move.
        const settleLaunch = holdLaunch(openResolvedPlayback);
        const launch = page.playEpisode(episode(1002));

        selectedItem.set(seriesView(104));
        page.resetForNewSeries();
        settleLaunch(opened);
        await launch;
        await flush();

        expect(savePlaybackPosition).not.toHaveBeenCalled();
        expect(page.episodePlaybackPositions().has(1002)).toBe(false);
    });

    it('skips the launch position of a visit the viewer left and came back to', async () => {
        const page = createPage();
        const settleLaunch = holdLaunch(openExternalPlayback);
        const launch = page.playEpisode(episode(1002), 'mpv');
        await flush();

        // Another series and back: the chain still launches for its owner,
        // only the visit differs.
        selectedItem.set(seriesView(104));
        page.resetForNewSeries();
        selectedItem.set(seriesView(103));
        page.resetForNewSeries();
        settleLaunch(opened);
        await expect(launch).resolves.toBe(opened);
        await flush();

        expect(savePlaybackPosition).not.toHaveBeenCalled();
        expect(page.episodePlaybackPositions().has(1002)).toBe(false);
    });

    it('leaves the episode unmarked when the page moved on while the position saved', async () => {
        const page = createPage();
        openExternalPlayback.mockResolvedValue(opened);
        let settleSave: () => void = () => undefined;
        savePlaybackPosition.mockImplementation(
            () => new Promise<void>((resolve) => (settleSave = resolve))
        );

        await page.playEpisode(episode(1002), 'mpv');
        await flush();
        expect(savePlaybackPosition).toHaveBeenCalledTimes(1);

        page.resetForNewSeries();
        settleSave();
        await flush();

        expect(page.episodePlaybackPositions().has(1002)).toBe(false);
    });
});
