import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    buildStalkerSelectedVodItem,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { EMPTY, of } from 'rxjs';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';

describe('StalkerSeriesViewComponent back navigation', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const routerMock = { navigateByUrl: jest.fn() };
    const locationMock = { back: jest.fn() };
    const clearSelectedItem = jest.fn();
    const originalHistoryState = window.history.state;
    const selectedItem = signal<Record<string, unknown> | null>({
        id: '42',
    });

    beforeEach(async () => {
        routerMock.navigateByUrl.mockReset();
        locationMock.back.mockReset();
        clearSelectedItem.mockReset();
        selectedItem.set({ id: '42' });

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType: signal('series'),
                        currentPlaylist: signal({
                            _id: 'stalker|playlist',
                            title: 'Portal',
                            portalUrl: 'https://stalker.example',
                            macAddress: '00:1A:79:12:34:56',
                        }),
                        getSerialSeasonsResource: () => [],
                        getVodSeriesSeasonsResource: () => [],
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading: signal(false),
                        fetchVodSeriesEpisodes: jest.fn(),
                        resolveVodPlayback: jest.fn(),
                        fetchLinkToPlay: jest.fn(),
                        clearSelectedItem,
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getSeriesPlaybackPositions: jest
                            .fn()
                            .mockResolvedValue([]),
                        savePlaybackPosition: jest.fn(),
                        clearPlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openResolvedPlayback: jest.fn(),
                    },
                },
                { provide: Router, useValue: routerMock },
                { provide: Location, useValue: locationMock },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                        getSeason: jest.fn(),
                        getSeasonEpisodes: jest.fn(),
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerSeriesViewComponent, {
                set: { template: '' },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerSeriesViewComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        window.history.replaceState(originalHistoryState, '');
    });

    it('steps back through history for a collection handoff', () => {
        // The originating collection keeps its tab, scope and open inline
        // detail only on the previous history entry.
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
            },
            ''
        );

        fixture.componentInstance.goBack();

        expect(locationMock.back).toHaveBeenCalledTimes(1);
        expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
        expect(clearSelectedItem).toHaveBeenCalled();
    });

    it('still re-navigates for a plain stalkerReturnTo handoff', () => {
        window.history.replaceState(
            { stalkerReturnTo: '/workspace/dashboard' },
            ''
        );

        fixture.componentInstance.goBack();

        expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/dashboard'
        );
        expect(locationMock.back).not.toHaveBeenCalled();
    });

    it('does not navigate when no return target is present', () => {
        window.history.replaceState({}, '');

        fixture.componentInstance.goBack();

        expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
        expect(locationMock.back).not.toHaveBeenCalled();
    });

    it('retires the return contract so a forward-replay cannot fire it again', () => {
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
            },
            ''
        );

        fixture.componentInstance.goBack();

        expect(locationMock.back).toHaveBeenCalledTimes(1);
        expect(window.history.state?.stalkerReturnByHistory).toBeUndefined();
        expect(window.history.state?.stalkerReturnTo).toBeUndefined();
    });

    it('matches a selection whose id came from stream_id', () => {
        selectedItem.set(
            buildStalkerSelectedVodItem({ stream_id: '42' } as never) as never
        );
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
            },
            ''
        );

        fixture.componentInstance.goBack();

        expect(locationMock.back).toHaveBeenCalledTimes(1);
    });

    it('ignores a marker left over from an earlier handoff on this entry', () => {
        // The return keys outlive the handoff, and a Stalker detail opens in
        // place — so a later title on the same entry must just close.
        selectedItem.set({ id: '77' });
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: '42',
            },
            ''
        );

        fixture.componentInstance.goBack();

        expect(locationMock.back).not.toHaveBeenCalled();
        expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
        expect(clearSelectedItem).toHaveBeenCalled();
    });
});
