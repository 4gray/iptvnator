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
import {
    SerialDetailsPlaybackService,
    type XtreamSerieDetailsView,
} from './serial-details-playback.service';
import { XTREAM_SERIES_RESUME_TARGET } from './serial-details-resume-target.token';
import { SerialDetailsSeasonWatchService } from './serial-details-season-watch.service';

const series = {
    series_id: 103,
    info: {},
    episodes: {},
} as unknown as XtreamSerieDetailsView;

/** A fresh page: the component provides the service, so each visit gets its own instance. */
function createPage(): SerialDetailsPlaybackService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            SerialDetailsPlaybackService,
            { provide: ActivatedRoute, useValue: {} },
            {
                provide: XtreamStore,
                useValue: { currentPlaylist: signal({ id: 'xtream-1' }) },
            },
            { provide: PORTAL_PLAYBACK_POSITIONS, useValue: {} },
            { provide: PORTAL_PLAYER, useValue: {} },
            {
                provide: PORTAL_EXTERNAL_PLAYBACK,
                useValue: { activeSession: signal(null) },
            },
            {
                provide: PlaybackPositionRuntimeBridgeService,
                useValue: { onPlaybackPositionUpdate: () => undefined },
            },
            { provide: PlaybackHistoryGate, useValue: {} },
            { provide: XTREAM_SERIES_RESUME_TARGET, useValue: signal(null) },
            {
                provide: SerialDetailsSeasonWatchService,
                useValue: { batchRunning: signal(false) },
            },
        ],
    });
    const service = TestBed.inject(SerialDetailsPlaybackService);
    service.bind({ selectedItem: signal(series) });
    return service;
}

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
