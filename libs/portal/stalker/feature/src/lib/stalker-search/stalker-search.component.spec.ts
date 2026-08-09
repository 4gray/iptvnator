import { Location } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import {
    StalkerPortalRepairService,
    StalkerSessionService,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { DataService, PlaylistsService } from '@iptvnator/services';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { StalkerSearchComponent } from './stalker-search.component';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

@Component({
    selector: 'app-stalker-inline-detail',
    standalone: true,
    template: '',
})
class StubStalkerInlineDetailComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly inlinePlayback = input<unknown>(null);
    readonly inlinePlaybackClosed = output<void>();
}

describe('StalkerSearchComponent playback session key', () => {
    let fixture: ComponentFixture<StalkerSearchComponent>;
    const playlist = signal({
        _id: 'playlist|one',
        title: 'Search portal',
        portalUrl: 'https://stalker.example',
        macAddress: '00:1A:79:12:34:56',
    });
    const selectedItem = signal<unknown>(null);
    const resolveVodPlayback = jest.fn();
    const snackBar = { open: jest.fn() };

    beforeEach(async () => {
        playlist.set({
            _id: 'playlist|one',
            title: 'Search portal',
            portalUrl: 'https://stalker.example',
            macAddress: '00:1A:79:12:34:56',
        });
        selectedItem.set(null);
        resolveVodPlayback.mockReset();
        snackBar.open.mockReset();
        await TestBed.configureTestingModule({
            imports: [StalkerSearchComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParamMap: of(convertToParamMap({})),
                        snapshot: {
                            data: {},
                            queryParamMap: convertToParamMap({}),
                            routeConfig: { path: 'search' },
                        },
                    },
                },
                { provide: Location, useValue: { back: jest.fn() } },
                { provide: DataService, useValue: {} },
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist: playlist },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: () => of([]) },
                },
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        setSelectedContentType: jest.fn(),
                        setSelectedItem: jest.fn((item) =>
                            selectedItem.set(item)
                        ),
                        addToFavorites: jest.fn(),
                        removeFromFavorites: jest.fn(),
                        resolveVodPlayback,
                    },
                },
                { provide: StalkerSessionService, useValue: {} },
                { provide: StalkerPortalRepairService, useValue: {} },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: signal(null) },
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
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openResolvedPlayback: jest.fn(),
                        openExternalPlayback: jest.fn(),
                    },
                },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        })
            .overrideComponent(StalkerSearchComponent, {
                set: {
                    imports: [StubStalkerInlineDetailComponent],
                    template: `
                        @if (showingDetails) {
                            <app-stalker-inline-detail
                                [playbackSessionKey]="playbackSessionKey()"
                                [inlinePlayback]="inlinePlayback()"
                                (inlinePlaybackClosed)="closeInlinePlayer()"
                            />
                        }
                    `,
                },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerSearchComponent);
    });

    afterEach(() => fixture?.destroy());

    it('owns the original item identity and threads it unchanged through payload replacement', () => {
        const first = {
            id: 'movie|one',
            cmd: 'ffrt4://movie/one',
            name: 'Movie One',
            info: { name: 'Movie One' },
        };
        fixture.componentInstance.selectItem(first);
        fixture.detectChanges();
        const expected = createPlaybackSessionKey({
            kind: 'vod',
            sourceId: 'playlist|one',
            contentId: 'movie|one',
        });
        const detail = fixture.debugElement.query(
            By.directive(StubStalkerInlineDetailComponent)
        ).componentInstance as StubStalkerInlineDetailComponent;
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);
        expect(detail.playbackSessionKey()).toBe(expected);

        fixture.componentInstance.inlinePlayback.set({
            streamUrl: 'https://alternative.example/replaced.mkv',
            title: 'Alternative movie',
            contentInfo: {
                playlistId: 'alternative-playlist',
                contentXtreamId: 999,
                contentType: 'vod',
            },
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(expected);

        fixture.componentInstance.selectItem({
            ...first,
            id: 'movie|two',
        });
        expect(fixture.componentInstance.playbackSessionKey()).not.toBe(
            expected
        );
        const itemChangedKey = fixture.componentInstance.playbackSessionKey();
        playlist.set({ ...playlist(), _id: 'playlist|two' });
        expect(fixture.componentInstance.playbackSessionKey()).not.toBe(
            itemChangedKey
        );
    });

    it('clears committed playback when the route playlist owner changes for the same provider id', async () => {
        const item = {
            id: 'movie|one',
            cmd: 'ffrt4://movie/one',
            name: 'Movie One',
            info: { name: 'Movie One' },
        };
        resolveVodPlayback.mockResolvedValue({
            streamUrl: 'https://a.example/movie.mpg',
        });
        fixture.componentInstance.selectItem(item);
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );
        await fixture.whenStable();
        expect(fixture.componentInstance.inlinePlayback()).not.toBeNull();

        playlist.set({ ...playlist(), _id: 'playlist|two' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'playlist|two',
                contentId: 'movie|one',
            })
        );
    });

    it('suppresses a pending old-playlist error for the same provider id', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        resolveVodPlayback.mockReturnValue(pending.promise);
        fixture.componentInstance.selectItem({
            id: 'movie|one',
            cmd: 'ffrt4://movie/one',
            name: 'Movie One',
            info: { name: 'Movie One' },
        });
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );
        await Promise.resolve();

        playlist.set({ ...playlist(), _id: 'playlist|two' });
        fixture.detectChanges();
        pending.reject(new Error('stale playlist failure'));
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('preserves committed playback when the same canonical owner object refreshes', async () => {
        const item = {
            id: 'movie|one',
            cmd: 'ffrt4://movie/one',
            name: 'Movie One',
            info: { name: 'Movie One' },
        };
        const playback = { streamUrl: 'https://a.example/movie.mpg' };
        resolveVodPlayback.mockResolvedValue(playback);
        fixture.componentInstance.selectItem(item);
        fixture.componentInstance.onVodPlay(
            fixture.componentInstance.vodDetailsItem()!
        );
        await fixture.whenStable();

        selectedItem.set({ ...item, screenshot_uri: 'refreshed.jpg' });
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBe(playback);
    });
});
