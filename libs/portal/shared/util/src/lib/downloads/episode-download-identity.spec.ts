import {
    createEpisodeDownloadIdentityKey,
    isEpisodeDownloadEligible,
    resolveEpisodeDownload,
    type EpisodeDownloadIdentity,
    type EpisodeDownloadRecord,
} from './episode-download-identity';

const identity: EpisodeDownloadIdentity = {
    playlistId: 'playlist-1',
    contentType: 'episode',
    xtreamId: 301,
    seriesXtreamId: 40,
    seasonNumber: 2,
    episodeNumber: 3,
};

function row(
    overrides: Partial<EpisodeDownloadRecord> = {}
): EpisodeDownloadRecord {
    return {
        id: 1,
        playlistId: identity.playlistId,
        contentType: identity.contentType,
        xtreamId: identity.xtreamId,
        seriesXtreamId: identity.seriesXtreamId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
        status: 'queued',
        filePath: '/downloads/episode-3.mp4',
        ...overrides,
    };
}

describe('episode download identity', () => {
    it('returns a canonical row when the same row also owns the coordinates', () => {
        const canonical = row();

        expect(resolveEpisodeDownload(identity, [canonical])).toEqual({
            kind: 'match',
            download: canonical,
        });
    });

    it.each([
        ['series id', { seriesXtreamId: null }],
        ['season number', { seasonNumber: null }],
        ['episode number', { episodeNumber: null }],
    ])(
        'treats a null legacy %s as an incomplete canonical row',
        (_label, override) => {
            const canonical = row(override);

            expect(resolveEpisodeDownload(identity, [canonical])).toEqual({
                kind: 'match',
                download: canonical,
            });
        }
    );

    it('fails closed when canonical and coordinate lookups find different rows', () => {
        const coordinateFallback = row({ xtreamId: 999 });
        const canonical = row();

        expect(
            resolveEpisodeDownload(identity, [coordinateFallback, canonical])
        ).toEqual({ kind: 'conflict' });
    });

    it('fails closed when an incomplete canonical row conflicts with a coordinate row', () => {
        const coordinateFallback = row({ id: 2, xtreamId: 999 });
        const incompleteCanonical = row({ seriesXtreamId: undefined });

        expect(
            resolveEpisodeDownload(identity, [
                coordinateFallback,
                incompleteCanonical,
            ])
        ).toEqual({ kind: 'conflict' });
    });

    it('fails closed when a canonical match has conflicting complete coordinates', () => {
        const coordinateFallback = row({ xtreamId: 999 });
        const conflictingCanonical = row({
            seriesXtreamId: 50,
            seasonNumber: 4,
            episodeNumber: 8,
        });

        expect(
            resolveEpisodeDownload(identity, [
                coordinateFallback,
                conflictingCanonical,
            ])
        ).toEqual({ kind: 'conflict' });
    });

    it('falls back to complete matching episode coordinates', () => {
        const coordinateFallback = row({ xtreamId: 999 });

        expect(resolveEpisodeDownload(identity, [coordinateFallback])).toEqual({
            kind: 'match',
            download: coordinateFallback,
        });
    });

    it('fails closed when multiple rows share the fallback coordinates', () => {
        const first = row({ id: 2, xtreamId: 999 });
        const second = row({ id: 3, xtreamId: 998 });

        const resolution = resolveEpisodeDownload(identity, [first, second]);

        expect(resolution).toEqual({ kind: 'conflict' });
        expect(isEpisodeDownloadEligible(resolution)).toBe(false);
    });

    it('does not fall back across playlists or to incomplete coordinates', () => {
        const candidates = [
            row({ playlistId: 'playlist-2' }),
            row({ xtreamId: 998, seriesXtreamId: undefined }),
            row({ xtreamId: 997, seasonNumber: undefined }),
            row({ xtreamId: 996, episodeNumber: undefined }),
            row({ contentType: 'vod', xtreamId: 995 }),
        ];

        expect(resolveEpisodeDownload(identity, candidates)).toEqual({
            kind: 'missing',
        });
    });

    it('allows an episode with no existing download', () => {
        expect(
            isEpisodeDownloadEligible(resolveEpisodeDownload(identity, []))
        ).toBe(true);
    });

    it.each([
        ['queued', undefined, false],
        ['downloading', undefined, false],
        ['paused', undefined, false],
        ['completed', 'available', false],
        ['completed', undefined, false],
        ['completed', 'not-applicable', false],
        ['completed', 'missing', true],
        ['failed', undefined, true],
        ['canceled', undefined, true],
    ] as const)(
        'returns %s with availability %s as eligible=%s',
        (status, fileAvailability, expected) => {
            expect(
                isEpisodeDownloadEligible({
                    kind: 'match',
                    download: row({ status, fileAvailability }),
                })
            ).toBe(expected);
        }
    );

    it('creates different keys for different playlists', () => {
        expect(createEpisodeDownloadIdentityKey(identity)).not.toBe(
            createEpisodeDownloadIdentityKey({
                ...identity,
                playlistId: 'playlist-2',
            })
        );
    });

    it('creates different keys for different episode coordinates', () => {
        expect(createEpisodeDownloadIdentityKey(identity)).not.toBe(
            createEpisodeDownloadIdentityKey({
                ...identity,
                episodeNumber: identity.episodeNumber + 1,
            })
        );
    });
});
