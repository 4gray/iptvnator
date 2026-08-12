import { audioDiffersFactually } from '@iptvnator/portal/shared/data-access';
import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import { currentSourceRow } from './vod-multi-source-current-row';
import { resolveVodMultiSourceMovie } from './vod-multi-source-identity';

/**
 * The row standing for the source the film is already playing from.
 *
 * It is never resolved — nothing needs to fetch a URL for the stream already on
 * screen — so it is the one row that can silently hold no provider facts, and
 * every comparison against it then has nothing on one side.
 */

const MOVIE = {
    playlistId: 'playlist-1',
    playlistName: 'Portal One',
    vodId: 101,
    catalogItem: { title: 'Dune' },
};

function alternative(language: string): VodSourceCandidate {
    return {
        id: 'playlist-2:xtream:991',
        playlistId: 'playlist-2',
        playlistName: 'Portal Two',
        portalType: 'xtream',
        contentId: 991,
        rawTitle: 'Dune',
        matchConfidence: 'exact',
        year: null,
        // Already canonical, as `applyApiMetadata` would have produced.
        audioLanguage: { value: language, provenance: 'api' },
    } as VodSourceCandidate;
}

describe('currentSourceRow', () => {
    it('states no facts before get_vod_info has landed', () => {
        const movie = resolveVodMultiSourceMovie({ ...MOVIE, vodInfo: null });

        const row = currentSourceRow(movie as never);

        // Silence is the honest reading of "not known yet" — a guess here
        // would be published with `api` provenance.
        expect(row.audio).toBeUndefined();
        expect(row.container).toBeUndefined();
        expect(row.quality).toBeUndefined();
    });

    it('carries the provider facts the route already loaded', () => {
        const movie = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: {
                name: 'Dune',
                audio: { codec_name: 'ac3' },
                video: { codec_name: 'h264', width: 1920, height: 1080 },
            } as never,
            containerExtension: 'mkv',
        });

        const row = currentSourceRow(movie as never);

        // Only the video codecs have canonical spellings; an audio name is
        // passed through as the provider wrote it.
        expect(row.audio).toEqual({ value: 'ac3', provenance: 'api' });
        expect(row.container).toEqual({ value: 'mkv', provenance: 'api' });
        expect(row.quality).toEqual({ value: '1080p', provenance: 'api' });
    });

    it('lets the dub warning fire on a route-to-alternative switch', () => {
        const movie = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: {
                name: 'Dune',
                audio: { codec_name: 'ac3', tags: { language: 'rus' } },
            } as never,
        });

        const row = currentSourceRow(movie as never);

        // `audioDiffersFactually` needs a fact on BOTH sides, so an empty
        // route row made the warning structurally unreachable on the
        // commonest switch there is — route to alternative. It only ever
        // fired between two alternatives that had both been resolved.
        expect(audioDiffersFactually(row, alternative('en'))).toBe(true);
        expect(audioDiffersFactually(row, alternative('ru'))).toBe(false);
    });

    it('reads the language off the route category, title prefix first', () => {
        const viaCategory = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: null,
            categoryName: 'EN | Netflix',
        });
        expect(currentSourceRow(viaCategory as never).categoryLanguage).toBe(
            'EN'
        );

        // A category prefix that is not a language stays out entirely.
        const viaNoise = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: null,
            categoryName: 'TOP | 250',
        });
        expect(currentSourceRow(viaNoise as never).categoryLanguage).toBeNull();

        const withoutCategory = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: null,
        });
        expect(
            currentSourceRow(withoutCategory as never).categoryLanguage
        ).toBeNull();
    });

    it('does not call a codec change a dub change', () => {
        const movie = resolveVodMultiSourceMovie({
            ...MOVIE,
            vodInfo: { name: 'Dune', audio: { codec_name: 'ac3' } } as never,
        });

        const row = currentSourceRow(movie as never);

        // The row states a codec and nothing about language. AAC and AC3
        // routinely carry the same dub, so there is nothing to warn about —
        // and warning anyway trains people to ignore the one that matters.
        expect(row.audio?.value).toBe('ac3');
        expect(row.audioLanguage).toBeUndefined();
        expect(audioDiffersFactually(row, alternative('en'))).toBe(false);
    });
});
