import { XtreamVodDetails } from '@iptvnator/shared/interfaces';
import {
    resolveXtreamVodPlaybackSource,
    XtreamVodPlaybackItem,
} from './xtream-vod-playback-source';

function createMovieDataDetails(
    overrides: Partial<NonNullable<XtreamVodDetails['movie_data']>> = {}
): XtreamVodDetails {
    return {
        movie_data: {
            added: '',
            category_id: '',
            container_extension: 'mp4',
            custom_sid: null,
            direct_source: '',
            name: 'Movie',
            stream_id: 101,
            ...overrides,
        },
    };
}

describe('resolveXtreamVodPlaybackSource', () => {
    it('resolves a source from movie_data', () => {
        expect(
            resolveXtreamVodPlaybackSource(createMovieDataDetails())
        ).toEqual({
            streamId: 101,
            containerExtension: 'mp4',
        });
    });

    it('falls back to catalog fields', () => {
        const item: XtreamVodPlaybackItem = {
            info: [],
            stream_id: '202',
            container_extension: ' mkv ',
        };

        expect(resolveXtreamVodPlaybackSource(item)).toEqual({
            streamId: 202,
            containerExtension: 'mkv',
        });
    });

    it('prefers movie_data over catalog fields', () => {
        const item: XtreamVodPlaybackItem = {
            ...createMovieDataDetails(),
            stream_id: 202,
            container_extension: 'mkv',
        };

        expect(resolveXtreamVodPlaybackSource(item)).toEqual({
            streamId: 101,
            containerExtension: 'mp4',
        });
    });

    it.each([
        undefined,
        {},
        { stream_id: 0, container_extension: 'mp4' },
        { stream_id: -1, container_extension: 'mp4' },
        { stream_id: 1.5, container_extension: 'mp4' },
        { stream_id: 'not-an-id', container_extension: 'mp4' },
        { stream_id: 101 },
        { stream_id: 101, container_extension: '   ' },
    ] as const)('returns null for an unusable item %#', (item) => {
        expect(resolveXtreamVodPlaybackSource(item)).toBeNull();
    });
});
