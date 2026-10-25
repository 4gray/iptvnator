import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IntroDbService } from '@iptvnator/services';
import type {
    IntroDbEpisodeSegments,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    createSkipSegments,
    toPlayerSkipSegments,
} from './portal-inline-player-skip-segments';
import type { SeriesEpisodeMetadata } from './series-playback-navigation';

const answer: IntroDbEpisodeSegments = {
    intro: { startSeconds: 60, endSeconds: 110 },
    recap: { startSeconds: 0, endSeconds: 40 },
    outro: { startSeconds: 2800, endSeconds: 2900 },
};

describe('toPlayerSkipSegments', () => {
    it('keeps recap and intro in playback order and leaves the outro out', () => {
        expect(toPlayerSkipSegments(answer)).toEqual([
            { kind: 'recap', startSeconds: 0, endSeconds: 40 },
            { kind: 'intro', startSeconds: 60, endSeconds: 110 },
        ]);
        expect(
            toPlayerSkipSegments({
                intro: null,
                recap: null,
                outro: answer.outro,
            })
        ).toBeNull();
        expect(toPlayerSkipSegments(null)).toBeNull();
    });
});

describe('createSkipSegments', () => {
    let getEpisodeSegments: jest.Mock;
    let playback: WritableSignal<ResolvedPortalPlayback | null>;
    let episodeMetadata: WritableSignal<SeriesEpisodeMetadata | null>;
    let seriesTitle: WritableSignal<string | null>;
    let seasonCount: WritableSignal<number>;
    let enabled: WritableSignal<boolean>;
    let autoSkip: WritableSignal<boolean>;

    const episode = (id: number): ResolvedPortalPlayback => ({
        streamUrl: `https://portal.example/series/${id}.mkv`,
        title: `Episode ${id}`,
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: id,
            contentType: 'episode',
        },
    });
    const flush = async () => {
        TestBed.tick();
        await Promise.resolve();
        await Promise.resolve();
    };
    const create = () =>
        TestBed.runInInjectionContext(() =>
            createSkipSegments({
                playback,
                episodeMetadata,
                seriesTitle,
                seriesTmdbId: signal(1399),
                seasonCount,
                enabled,
                autoSkip,
            })
        );

    beforeEach(() => {
        getEpisodeSegments = jest.fn().mockResolvedValue(answer);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: IntroDbService,
                    useValue: { isAvailable: true, getEpisodeSegments },
                },
            ],
        });
        playback = signal(episode(11));
        episodeMetadata = signal({
            label: 'S01E02',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        seriesTitle = signal('Breaking Bad');
        seasonCount = signal(5);
        enabled = signal(true);
        autoSkip = signal(false);
    });

    it('asks nothing while the viewer has the button turned off', async () => {
        enabled.set(false);
        const segments = create();
        await flush();

        expect(getEpisodeSegments).not.toHaveBeenCalled();
        expect(segments()).toBeNull();

        enabled.set(true);
        await flush();
        expect(getEpisodeSegments).toHaveBeenCalledTimes(1);
        expect(segments()).not.toBeNull();
    });

    it('flags the segments for auto-skip without asking IntroDB again', async () => {
        const segments = create();
        await flush();
        expect(segments()?.every((segment) => !segment.autoSkip)).toBe(true);

        autoSkip.set(true);
        await flush();

        expect(segments()?.every((segment) => segment.autoSkip)).toBe(true);
        expect(getEpisodeSegments).toHaveBeenCalledTimes(1);
    });

    it('looks up the playing episode and exposes its segments', async () => {
        const segments = create();
        await flush();

        expect(getEpisodeSegments).toHaveBeenCalledWith({
            tmdbId: 1399,
            seriesTitle: 'Breaking Bad',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        expect(segments()?.map((segment) => segment.kind)).toEqual([
            'recap',
            'intro',
        ]);
    });

    it('renumbers a one-season provider slice from its title marker', async () => {
        seriesTitle.set('The Boys S05');
        seasonCount.set(1);
        create();
        await flush();

        expect(getEpisodeSegments).toHaveBeenCalledWith(
            expect.objectContaining({ seasonNumber: 5, episodeNumber: 2 })
        );
    });

    it('drops the previous episode segments while the next one loads', async () => {
        const segments = create();
        await flush();
        expect(segments()).not.toBeNull();

        getEpisodeSegments.mockReturnValue(new Promise(() => undefined));
        playback.set(episode(12));
        episodeMetadata.set({
            label: 'S01E03',
            seasonNumber: 1,
            episodeNumber: 3,
        });
        await flush();

        expect(segments()).toBeNull();
    });

    it('asks nothing for movies and live playback', async () => {
        playback.set({
            ...episode(11),
            contentInfo: {
                playlistId: 'p',
                contentXtreamId: 11,
                contentType: 'vod',
            },
        });
        const segments = create();
        await flush();
        playback.set({ ...episode(11), isLive: true });
        await flush();

        expect(getEpisodeSegments).not.toHaveBeenCalled();
        expect(segments()).toBeNull();
    });
});
