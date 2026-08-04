import { EMPTY, of } from 'rxjs';
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
    StalkerStore,
    type StalkerMappedEpisode,
    type StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { TmdbEnrichmentService } from '@iptvnator/services';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { STALKER_SERIES_DOWNLOAD_MODES } from './stalker-series-download.adapter';
import { createStalkerEpisodePlaybackSessionKey } from './stalker-episode-playback-session-key';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('StalkerSeriesViewComponent playback session key', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const selectedContentType = signal<'series' | 'vod'>('series');
    const selectedItem = signal<StalkerVodSource | null>(null);
    const serialSeasons = signal<unknown[]>([]);
    const vodSeasons = signal<unknown[]>([]);
    const resolveVodPlayback = jest.fn();
    const tmdbGetSeason = jest.fn();
    const currentPlaylist = signal({
        _id: 'stalker|playlist',
        title: 'Portal',
        portalUrl: 'https://stalker.example',
        macAddress: '00:1A:79:12:34:56',
    });

    beforeEach(async () => {
        selectedContentType.set('series');
        selectedItem.set({
            id: 'series|parent',
            info: { name: 'Series', movie_image: 'poster.jpg' },
        });
        serialSeasons.set([
            {
                id: 'regular-season',
                name: 'Season 1',
                cmd: 'ffrt4://regular|full-command',
                series: [1, 2],
            },
        ]);
        vodSeasons.set([]);
        resolveVodPlayback
            .mockReset()
            .mockImplementation(
                async (
                    _command: string,
                    title: string,
                    thumbnail: string,
                    _episodeNumber: number,
                    episodeId: number
                ) => ({
                    streamUrl: 'https://resolved.example/temporary.mpg',
                    title,
                    thumbnail,
                    contentInfo: {
                        playlistId: 'transport-playlist',
                        contentXtreamId: episodeId,
                        contentType: 'episode',
                        seriesXtreamId: 999,
                    },
                })
            );
        tmdbGetSeason.mockReset().mockResolvedValue(null);

        await TestBed.configureTestingModule({
            imports: [StalkerSeriesViewComponent],
            providers: [
                {
                    provide: StalkerStore,
                    useValue: {
                        selectedItem,
                        selectedContentType,
                        currentPlaylist,
                        getSerialSeasonsResource: () => serialSeasons(),
                        getVodSeriesSeasonsResource: () => vodSeasons(),
                        isVodSeriesSeasonsLoading: signal(false),
                        isSerialSeasonsLoading: signal(false),
                        fetchVodSeriesEpisodes: jest.fn(),
                        resolveVodPlayback,
                        fetchLinkToPlay: jest.fn(),
                        clearSelectedItem: jest.fn(),
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
                { provide: Router, useValue: { navigateByUrl: jest.fn() } },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        isEnabled: () => false,
                        getSeason: tmdbGetSeason,
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
    });

    afterEach(() => fixture.destroy());

    async function playFirstEpisode(): Promise<StalkerMappedEpisode> {
        fixture.detectChanges();
        await fixture.whenStable();
        const episode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0] as StalkerMappedEpisode;
        fixture.componentInstance.onEpisodeClicked(episode);
        await fixture.whenStable();
        return episode;
    }

    function setLazySeries(parentId: string, episodeId: string): void {
        selectedContentType.set('vod');
        selectedItem.set({
            id: parentId,
            is_series: true,
            info: { name: 'Lazy series', movie_image: 'poster.jpg' },
        });
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'lazy-season',
                video_id: parentId,
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: episodeId,
                        series_number: 3,
                        name: 'Replacement episode',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
    }

    it.each([
        STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
        STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod,
        STALKER_SERIES_DOWNLOAD_MODES.LazyVod,
    ])('owns a collision-safe key for %s playback', async (expectedMode) => {
        if (expectedMode === STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod) {
            fixture.componentRef.setInput('vodWithSeries', {
                id: 'series|parent',
                cmd: 'ffrt4://embedded|full-command',
                series: [1, 2],
                info: { name: 'Embedded series', movie_image: 'poster.jpg' },
            });
        } else if (expectedMode === STALKER_SERIES_DOWNLOAD_MODES.LazyVod) {
            selectedContentType.set('vod');
            selectedItem.set({
                id: 'series|parent',
                is_series: true,
                info: { name: 'Lazy series', movie_image: 'poster.jpg' },
            });
            vodSeasons.set([]);
            fixture.detectChanges();
            fixture.componentInstance.vodSeriesSeasons.set([
                {
                    id: 'season|provider',
                    video_id: 'series|parent',
                    season_number: '1',
                    name: 'Season | One',
                    episodes: [
                        {
                            id: 'episode|provider:full',
                            series_number: 1,
                            name: 'Pilot',
                        },
                    ],
                    isLoading: false,
                    isExpanded: false,
                },
            ]);
        }

        const episode = await playFirstEpisode();
        const key = fixture.componentInstance.playbackSessionKey();

        expect(fixture.componentInstance.seriesMode()).toBe(expectedMode);
        expect(key).not.toBe('');
        expect(key).not.toContain(String(episode.id));

        fixture.componentInstance.inlinePlayback.set({
            streamUrl: 'https://alternative.example/replacement.mkv',
            title: 'Replacement payload',
            contentInfo: {
                playlistId: 'alternative-playlist',
                contentXtreamId: 987654321,
                contentType: 'episode',
                seriesXtreamId: 123,
                seasonNumber: 9,
                episodeNumber: 9,
            },
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
    });

    it('preserves the logical key when the provider command rotates', async () => {
        await playFirstEpisode();
        const firstKey = fixture.componentInstance.playbackSessionKey();
        serialSeasons.set([
            {
                id: 'replacement-season',
                name: 'Season 1',
                cmd: 'ffrt4://different|full-command',
                series: [1],
            },
        ]);

        await playFirstEpisode();

        expect(fixture.componentInstance.playbackSessionKey()).toBe(firstKey);
        expect(firstKey).not.toContain('ffrt4://regular|full-command');
        expect(firstKey).not.toContain('ffrt4://different|full-command');
    });

    it('rejects a pending command refresh but lets the refreshed episode reuse its logical key', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const pending = deferred<ResolvedPortalPlayback>();
        resolveVodPlayback.mockReturnValueOnce(pending.promise);
        const [seasonKeyA, episodesA] = Object.entries(
            fixture.componentInstance.mappedSeasons()
        )[0];
        const episodeA = episodesA[0] as StalkerMappedEpisode;
        const expectedKey = createStalkerEpisodePlaybackSessionKey({
            sourceId: 'stalker|playlist',
            parentSeriesId: 'series|parent',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: {
                seasonKey: seasonKeyA,
                seasonNumber: Number(episodeA.season) || Number(seasonKeyA),
                episodeNumber: Number(episodeA.episode_num),
                episode: episodeA,
                previous: null,
                next: null,
            },
        });
        fixture.componentInstance.onEpisodeClicked(episodeA);

        serialSeasons.set([
            {
                id: 'replacement-season',
                name: 'Season 1',
                cmd: 'ffrt4://refreshed|full-command',
                series: [1, 2],
            },
        ]);
        fixture.detectChanges();
        const [seasonKeyB, episodesB] = Object.entries(
            fixture.componentInstance.mappedSeasons()
        )[0];
        const episodeB = episodesB[0] as StalkerMappedEpisode;
        const refreshedKey = createStalkerEpisodePlaybackSessionKey({
            sourceId: 'stalker|playlist',
            parentSeriesId: 'series|parent',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: {
                seasonKey: seasonKeyB,
                seasonNumber: Number(episodeB.season) || Number(seasonKeyB),
                episodeNumber: Number(episodeB.episode_num),
                episode: episodeB,
                previous: null,
                next: episodesB[1] ?? null,
            },
        });

        expect(episodeB.originalCmd).not.toBe(episodeA.originalCmd);
        expect(episodeB.id).not.toBe(episodeA.id);
        expect(refreshedKey).toBe(expectedKey);

        pending.resolve({
            streamUrl: 'https://stale.example/old-command.mpg',
            contentInfo: {
                playlistId: 'transport-playlist',
                contentXtreamId: episodeA.id,
                contentType: 'episode',
            },
        });
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(fixture.componentInstance.playbackSessionKey()).toBe('');
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();

        fixture.componentInstance.onEpisodeClicked(episodeB);
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            'ffrt4://refreshed|full-command',
            'Series',
            'poster.jpg',
            1,
            Number(episodeB.id),
            undefined
        );
        expect(fixture.componentInstance.inlinePlayback()).not.toBeNull();
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            expectedKey
        );
    });

    it('selects the exact clicked episode when distinct provider commands collide in the tracking hash', async () => {
        serialSeasons.set([
            {
                id: 'collision-a',
                name: 'Season A',
                cmd: 'collision-cmd-1000',
                series: [1],
            },
            {
                id: 'collision-b',
                name: 'Season B',
                cmd: 'collision-cmd-425721',
                series: [1],
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();
        const [episodeA, episodeB] = Object.values(
            fixture.componentInstance.mappedSeasons()
        ).map((episodes) => episodes[0] as StalkerMappedEpisode);

        expect(episodeA.id).toBe('1511026353');
        expect(episodeB.id).toBe(episodeA.id);

        fixture.componentInstance.onEpisodeClicked(episodeB);
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            'collision-cmd-425721',
            'Series',
            'poster.jpg',
            1,
            1511026353,
            undefined
        );
        const expectedBKey = createStalkerEpisodePlaybackSessionKey({
            sourceId: 'stalker|playlist',
            parentSeriesId: 'series|parent',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: {
                seasonKey: '2',
                seasonNumber: 2,
                episodeNumber: 1,
                episode: episodeB,
                previous: null,
                next: null,
            },
        });
        const wrongAKey = createStalkerEpisodePlaybackSessionKey({
            sourceId: 'stalker|playlist',
            parentSeriesId: 'series|parent',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: {
                seasonKey: '1',
                seasonNumber: 1,
                episodeNumber: 1,
                episode: episodeA,
                previous: null,
                next: null,
            },
        });
        expect(fixture.componentInstance.playbackSessionKey()).toBe(
            expectedBKey
        );
        expect(expectedBKey).not.toBe(wrongAKey);
    });

    it.each(['parent', 'mode', 'playlist'] as const)(
        'clears committed playback when the canonical %s owner changes',
        async (transition) => {
            await playFirstEpisode();
            expect(fixture.componentInstance.inlinePlayback()).not.toBeNull();

            if (transition === 'parent') {
                selectedItem.set({
                    ...selectedItem()!,
                    id: 'replacement-parent',
                });
            } else if (transition === 'mode') {
                selectedContentType.set('vod');
                selectedItem.set({ ...selectedItem()!, is_series: true });
            } else {
                currentPlaylist.set({
                    ...currentPlaylist(),
                    _id: 'replacement-playlist',
                });
            }
            fixture.detectChanges();
            await fixture.whenStable();

            expect(fixture.componentInstance.inlinePlayback()).toBeNull();
            expect(fixture.componentInstance.playbackSessionKey()).toBe('');
        }
    );

    it('preserves committed playback across a same-owner object refresh', async () => {
        await playFirstEpisode();
        const playback = fixture.componentInstance.inlinePlayback();
        const key = fixture.componentInstance.playbackSessionKey();

        selectedItem.set({ ...selectedItem()! });
        currentPlaylist.set({ ...currentPlaylist() });
        serialSeasons.set(
            serialSeasons().map((season) => ({
                ...(season as Record<string, unknown>),
            }))
        );
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBe(playback);
        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
    });

    it('re-resolves mounted episode metadata and neighbors after a same-owner season refresh', async () => {
        serialSeasons.set([
            {
                id: 'regular-season',
                name: 'Season 1',
                cmd: 'ffrt4://regular|full-command',
                series: [1, 2, 3],
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();
        const initialEpisodes = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0] as StalkerMappedEpisode[];
        fixture.componentInstance.onEpisodeClicked(initialEpisodes[1]);
        await fixture.whenStable();
        const key = fixture.componentInstance.playbackSessionKey();

        serialSeasons.set([
            {
                id: 'refreshed-season',
                name: 'Season 1',
                cmd: 'ffrt4://refreshed|full-command',
                series: [1, 2, 3],
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();
        const refreshedEpisodes = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0] as StalkerMappedEpisode[];
        const state = fixture.componentInstance.inlineEpisodeState();

        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
        expect(state?.episode).toBe(refreshedEpisodes[1]);
        expect(state?.previous).toBe(refreshedEpisodes[0]);
        expect(state?.next).toBe(refreshedEpisodes[2]);

        fixture.componentInstance.handleInlinePlaybackEnded();
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenCalledTimes(2);
        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            'ffrt4://refreshed|full-command',
            'Series',
            'poster.jpg',
            3,
            Number(refreshedEpisodes[2].id),
            undefined
        );
    });

    it('re-resolves mounted episode metadata after same-owner TMDB enrichment', async () => {
        await playFirstEpisode();
        const key = fixture.componentInstance.playbackSessionKey();
        tmdbGetSeason.mockResolvedValue({
            overview: 'Season overview',
            episodes: [{ episode_number: 1, name: 'TMDB Pilot' }],
        });
        const item = selectedItem();
        if (!item) throw new Error('Expected the selected series');
        selectedItem.set({
            ...item,
            info: { ...item.info, tmdb_id: 314 },
        });

        fixture.componentInstance.onSeasonSelected('1');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const currentEpisode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0];

        expect(tmdbGetSeason).toHaveBeenCalledWith(314, 1);
        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
        expect(fixture.componentInstance.inlineEpisodeState()?.episode).toBe(
            currentEpisode
        );
        expect(fixture.componentInstance.inlineEpisodeMetadata()?.title).toBe(
            'TMDB Pilot'
        );
    });

    it('uses the current mapped episode when a stale lazy-series event resolves', async () => {
        selectedContentType.set('vod');
        selectedItem.set({
            id: 'series|parent',
            is_series: true,
            info: {
                name: 'Lazy series',
                movie_image: 'poster.jpg',
                tmdb_id: 2718,
            },
        });
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'lazy-season',
                video_id: 'series|parent',
                season_number: '2',
                name: 'Season 2',
                episodes: [
                    {
                        id: 'provider-episode',
                        series_number: 3,
                        name: 'Episode 3',
                    },
                ],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();
        const staleEpisode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0] as StalkerMappedEpisode;
        tmdbGetSeason.mockResolvedValue({
            episodes: [{ episode_number: 3, name: 'Current TMDB title' }],
        });

        fixture.componentInstance.onSeasonSelected('2');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(
            Object.values(fixture.componentInstance.mappedSeasons())[0][0].title
        ).toBe('Current TMDB title');

        fixture.componentInstance.onEpisodeClicked(staleEpisode);
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenLastCalledWith(
            '/media/file_provider-episode.mpg',
            'Lazy series - Current TMDB title',
            'poster.jpg',
            3,
            expect.any(Number),
            undefined
        );
    });

    it('fails mounted episode commands closed when a same-owner refresh removes the episode', async () => {
        serialSeasons.set([
            {
                id: 'regular-season',
                name: 'Season 1',
                cmd: 'ffrt4://regular|full-command',
                series: [1, 2, 3],
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();
        const episodes = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0] as StalkerMappedEpisode[];
        fixture.componentInstance.onEpisodeClicked(episodes[1]);
        await fixture.whenStable();
        const key = fixture.componentInstance.playbackSessionKey();

        serialSeasons.set([
            {
                id: 'refreshed-season',
                name: 'Season 1',
                cmd: 'ffrt4://refreshed|full-command',
                series: [1],
            },
        ]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
        expect(fixture.componentInstance.inlineEpisodeState()).toBeNull();
        expect(fixture.componentInstance.inlineEpisodeMetadata()).toBeNull();
        expect(fixture.componentInstance.inlineSeriesNavigation()).toBeNull();

        fixture.componentInstance.playPreviousEpisode();
        fixture.componentInstance.playNextEpisode();
        fixture.componentInstance.handleInlinePlaybackEnded();
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenCalledTimes(1);
    });

    it('rejects a completion after its playlist, parent, mode, and episode owner change', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const pending = deferred<ResolvedPortalPlayback>();
        resolveVodPlayback.mockReturnValueOnce(pending.promise);
        const episode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0] as StalkerMappedEpisode;
        fixture.componentInstance.onEpisodeClicked(episode);

        currentPlaylist.set({
            ...currentPlaylist(),
            _id: 'replacement-playlist',
        });
        setLazySeries('replacement-parent', 'replacement-provider-episode');
        pending.resolve({
            streamUrl: 'https://stale.example/old-episode.mpg',
            contentInfo: {
                playlistId: 'transport-playlist',
                contentXtreamId: episode.id,
                contentType: 'episode',
            },
        });
        await fixture.whenStable();

        expect(fixture.componentInstance.inlinePlayback()).toBeNull();
        expect(fixture.componentInstance.playbackSessionKey()).toBe('');
    });

    it('keeps the newest episode when owner-scoped requests resolve out of order', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const oldRequest = deferred<ResolvedPortalPlayback>();
        const newRequest = deferred<ResolvedPortalPlayback>();
        resolveVodPlayback
            .mockReturnValueOnce(oldRequest.promise)
            .mockReturnValueOnce(newRequest.promise);
        const oldEpisode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0] as StalkerMappedEpisode;
        fixture.componentInstance.onEpisodeClicked(oldEpisode);

        currentPlaylist.set({ ...currentPlaylist(), _id: 'new-playlist' });
        setLazySeries('new-parent', 'new-provider-episode');
        const newEpisode = Object.values(
            fixture.componentInstance.mappedSeasons()
        )[0][0] as StalkerMappedEpisode;
        fixture.componentInstance.onEpisodeClicked(newEpisode);
        const newestPlayback = {
            streamUrl: 'https://new.example/episode.mpg',
            contentInfo: {
                playlistId: 'transport-playlist',
                contentXtreamId: newEpisode.id,
                contentType: 'episode' as const,
            },
        };
        newRequest.resolve(newestPlayback);
        oldRequest.resolve({
            streamUrl: 'https://old.example/episode.mpg',
            contentInfo: {
                playlistId: 'transport-playlist',
                contentXtreamId: oldEpisode.id,
                contentType: 'episode',
            },
        });
        await fixture.whenStable();

        expect(resolveVodPlayback).toHaveBeenCalledTimes(2);
        expect(fixture.componentInstance.inlinePlayback()?.streamUrl).toBe(
            newestPlayback.streamUrl
        );
        expect(fixture.componentInstance.playbackSessionKey()).not.toBe('');
    });

    it('preserves a valid mounted episode when original identity is missing', async () => {
        await playFirstEpisode();
        const playback = fixture.componentInstance.inlinePlayback();
        const key = fixture.componentInstance.playbackSessionKey();
        serialSeasons.set([
            {
                id: 'identity-less-season',
                name: 'Season 1',
                series: [1],
            },
        ]);

        await playFirstEpisode();

        expect(fixture.componentInstance.inlinePlayback()).toBe(playback);
        expect(fixture.componentInstance.playbackSessionKey()).toBe(key);
    });
});
