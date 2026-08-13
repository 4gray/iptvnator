import { Location } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    PlaylistsService,
} from '@iptvnator/services';
import { VodDetailsComponent } from '@iptvnator/ui/playback';
import { EMPTY, of } from 'rxjs';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import { StalkerCatalogDetailComponent } from './stalker-catalog-detail.component';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

@Component({ selector: 'app-vod-details', template: '' })
class StubVodDetailsComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly item = input.required<unknown>();
    readonly providerOnly = input(false);
    readonly isFavorite = input(false);
    readonly playbackPosition = input<number | null>(null);
    readonly inlinePlayback = input<unknown>(null);
    readonly externalPlayback = input<unknown>(null);
    readonly playClicked = output<unknown>();
    readonly resumeClicked = output<unknown>();
    readonly favoriteToggled = output<unknown>();
    readonly downloadRequested = output<unknown>();
    readonly backClicked = output<void>();
    readonly inlineTimeUpdated = output<unknown>();
    readonly inlinePlaybackClosed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly inlineExternalFallbackRequested = output<unknown>();
}

@Component({ selector: 'app-stalker-series-view', template: '' })
class StubStalkerSeriesViewComponent {
    readonly vodWithSeries = input<unknown>(null);
    readonly providerOnly = input(false);
}

describe('StalkerCatalogDetailComponent provider presentation', () => {
    let fixture: ComponentFixture<StalkerCatalogDetailComponent>;
    const resolveVodPlayback = jest.fn();
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openResolvedPlayback: jest.fn(),
        openExternalPlayback: jest.fn(),
    };
    const contentType = signal<'vod' | 'series'>('vod');
    const catalogPlaylist = signal({ id: 'stalker-1' });
    const snackBar = { open: jest.fn() };
    const routerMock = { navigateByUrl: jest.fn() };
    const locationMock = { back: jest.fn() };
    const originalHistoryState = window.history.state;
    const selectedItem = signal<unknown>({
        id: '42',
        cmd: '/media/42',
        info: { name: 'Portal movie' },
    });

    beforeEach(async () => {
        contentType.set('vod');
        selectedItem.set({
            id: '42',
            cmd: '/media/42',
            info: { name: 'Portal movie' },
        });
        resolveVodPlayback.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        catalogPlaylist.set({ id: 'stalker-1' });
        snackBar.open.mockReset();
        routerMock.navigateByUrl.mockReset();
        locationMock.back.mockReset();

        await TestBed.configureTestingModule({
            imports: [StalkerCatalogDetailComponent],
            providers: [
                {
                    provide: StalkerCatalogFacadeService,
                    useValue: {
                        contentType,
                        selectedItem,
                        playlist: catalogPlaylist,
                        clearSelectedItem: jest.fn(),
                        resolveVodPlayback,
                    },
                },
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getPlaybackPosition: jest.fn().mockResolvedValue(null),
                        savePlaybackPosition: jest.fn(),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: portalPlayer,
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: { onPlaybackPositionUpdate: jest.fn() },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: jest.fn(() => of([])) },
                },
                { provide: DownloadsService, useValue: {} },
                { provide: Router, useValue: routerMock },
                { provide: Location, useValue: locationMock },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                        onDefaultLangChange: EMPTY,
                    },
                },
            ],
        })
            .overrideComponent(StalkerCatalogDetailComponent, {
                remove: {
                    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
                },
                add: {
                    imports: [
                        StubStalkerSeriesViewComponent,
                        StubVodDetailsComponent,
                    ],
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerCatalogDetailComponent);
    });

    afterEach(() => {
        fixture.destroy();
        window.history.replaceState(originalHistoryState, '');
    });

    it('passes provider-only mode to the matching regular VOD', async () => {
        fixture.componentRef.setInput('providerOnly', true);
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(true);
        expect(child.providerOnly()).toBe(true);
        expect(child.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-1',
                contentId: '42',
            })
        );
    });

    it('keeps provider-only presentation disabled for a regular VOD open', async () => {
        selectedItem.set({
            id: '99',
            cmd: '/media/99',
            info: { name: 'Another movie' },
        });
        await fixture.whenStable();

        const child = fixture.debugElement.query(
            By.directive(StubVodDetailsComponent)
        ).componentInstance as StubVodDetailsComponent;
        expect(fixture.componentInstance.providerOnly()).toBe(false);
        expect(child.providerOnly()).toBe(false);
        expect(child.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-1',
                contentId: '99',
            })
        );
    });

    it.each([
        ['embedded VOD series', 'vod', { id: '42', series: [1] }],
        ['Ministra VOD series', 'vod', { id: '42', is_series: '1' }],
        ['regular series', 'series', { id: '42' }],
    ] as const)(
        'passes provider-only mode to %s',
        async (_label, type, item) => {
            fixture.componentRef.setInput('providerOnly', true);
            contentType.set(type);
            selectedItem.set({
                ...item,
                cmd: '/media/42',
                info: { name: 'Portal series' },
            });
            await fixture.whenStable();

            const child = fixture.debugElement.query(
                By.directive(StubStalkerSeriesViewComponent)
            ).componentInstance as StubStalkerSeriesViewComponent;
            expect(child.providerOnly()).toBe(true);
        }
    );

    it('does not mount a VOD resolution after the catalog owner changes', async () => {
        let resolve!: (value: { streamUrl: string }) => void;
        resolveVodPlayback.mockReturnValueOnce(
            new Promise((resolvePromise) => {
                resolve = resolvePromise;
            })
        );
        fixture.detectChanges();
        fixture.componentInstance.onVodPlay({
            type: 'stalker',
            cmd: '/media/42',
            data: selectedItem(),
        } as never);

        selectedItem.set({
            id: '99',
            cmd: '/media/99',
            info: { name: 'Replacement movie' },
        });
        fixture.detectChanges();
        resolve({ streamUrl: 'https://stale.example/movie.mpg' });
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
    });

    it('clears committed VOD playback when the playlist changes with the same provider id', async () => {
        const playback = { streamUrl: 'https://a.example/movie.mpg' };
        resolveVodPlayback.mockResolvedValue(playback);
        fixture.detectChanges();
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );
        await fixture.whenStable();
        expect(fixture.componentInstance.inlinePlayback()).toBe(playback);

        catalogPlaylist.set({ id: 'stalker-2' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'stalker-2',
                contentId: '42',
            })
        );
    });

    it('does not mount a pending VOD resolution after only the playlist owner changes', async () => {
        const pending = deferred<{ streamUrl: string }>();
        resolveVodPlayback.mockReturnValue(pending.promise);
        fixture.detectChanges();
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );

        catalogPlaylist.set({ id: 'stalker-2' });
        fixture.detectChanges();
        pending.resolve({ streamUrl: 'https://stale.example/movie.mpg' });
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
    });

    it('suppresses a pending VOD error after the playlist owner changes', async () => {
        const pending = deferred<{ streamUrl: string }>();
        resolveVodPlayback.mockReturnValue(pending.promise);
        fixture.detectChanges();
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );

        catalogPlaylist.set({ id: 'stalker-2' });
        fixture.detectChanges();
        pending.reject(new Error('stale playlist failure'));
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('preserves committed playback across a same-owner item refresh', async () => {
        const playback = { streamUrl: 'https://a.example/movie.mpg' };
        resolveVodPlayback.mockResolvedValue(playback);
        fixture.detectChanges();
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );
        await fixture.whenStable();

        selectedItem.set({
            ...(selectedItem() as Record<string, unknown>),
            screenshot_uri: 'refreshed.jpg',
        });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBe(playback);
    });

    it('steps back through history for a collection handoff', () => {
        // The collection's tab, scope and open inline detail live only on the
        // previous history entry; re-navigating would drop them.
        window.history.replaceState(
            {
                stalkerReturnTo: '/workspace/global-favorites',
                stalkerReturnByHistory: true,
            },
            ''
        );
        fixture.detectChanges();

        fixture.componentInstance.onVodBack();

        expect(locationMock.back).toHaveBeenCalledTimes(1);
        expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    });

    it('still re-navigates for a plain stalkerReturnTo handoff', () => {
        window.history.replaceState(
            { stalkerReturnTo: '/workspace/dashboard' },
            ''
        );
        fixture.detectChanges();

        fixture.componentInstance.onVodBack();

        expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/dashboard'
        );
        expect(locationMock.back).not.toHaveBeenCalled();
    });

    it('does not navigate when no return target is present', () => {
        window.history.replaceState({}, '');
        fixture.detectChanges();

        fixture.componentInstance.onVodBack();

        expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
        expect(locationMock.back).not.toHaveBeenCalled();
    });
});
