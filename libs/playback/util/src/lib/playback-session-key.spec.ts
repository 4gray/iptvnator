import * as playbackSessionKey from './playback-session-key';
import type { PlaybackSessionIdentity } from './playback-session-key';

const { createPlaybackSessionKey } = playbackSessionKey;

describe('playback session key', () => {
    it('length-prefixes every identity part', () => {
        expect(
            createPlaybackSessionKey({
                kind: 'episode',
                sourceId: 'list:west|hd',
                contentId: 'ep:4|finale',
                seriesId: 'series|2:remaster',
                seasonNumber: 3,
                episodeNumber: 4,
            })
        ).toBe(
            '7:episode|12:list:west|hd|11:ep:4|finale|17:series|2:remaster|1:3|1:4'
        );
    });

    it.each([
        [
            { kind: 'live', sourceId: 'a', contentId: 'b|c' },
            { kind: 'live', sourceId: 'a|b', contentId: 'c' },
        ],
        [
            { kind: 'vod', sourceId: 'a:1', contentId: '2' },
            { kind: 'vod', sourceId: 'a', contentId: '1:2' },
        ],
        [
            {
                kind: 'episode',
                sourceId: 'source',
                contentId: 'content',
                seriesId: 'series:1|2',
                seasonNumber: 3,
                episodeNumber: 4,
            },
            {
                kind: 'episode',
                sourceId: 'source',
                contentId: 'content',
                seriesId: 'series',
                seasonNumber: 1,
                episodeNumber: 2,
            },
        ],
    ] as const)(
        'does not collide delimiter-bearing identities %#',
        (left, right) => {
            expect(createPlaybackSessionKey(left)).not.toBe(
                createPlaybackSessionKey(right)
            );
        }
    );

    it('reuses canonical movie identity across provider copies and source URLs', () => {
        const logicalIdentity: PlaybackSessionIdentity = {
            kind: 'vod',
            sourceId: 'catalog:featured',
            contentId: 'movie:42',
        };
        const originalCopy = {
            providerId: 'provider:one',
            sourceUrl: 'https://one.example/movie/42',
            logicalIdentity,
        };
        const alternativeCopy = {
            providerId: 'provider|two',
            sourceUrl: 'https://two.example/alternate/9001',
            logicalIdentity,
        };

        expect(createPlaybackSessionKey(originalCopy.logicalIdentity)).toBe(
            createPlaybackSessionKey(alternativeCopy.logicalIdentity)
        );
    });

    it.each([
        [{ kind: 'live', sourceId: 'playlist:2', contentId: 42 }],
        [{ kind: 'live', sourceId: 'playlist:1', contentId: 43 }],
        [{ kind: 'vod', sourceId: 'playlist:1', contentId: 42 }],
    ] as const)(
        'changes when a live channel identity changes: %o',
        (changedIdentity) => {
            const original = createPlaybackSessionKey({
                kind: 'live',
                sourceId: 'playlist:1',
                contentId: 42,
            });

            expect(createPlaybackSessionKey(changedIdentity)).not.toBe(
                original
            );
        }
    );

    it.each([
        [{ kind: 'vod', sourceId: 'playlist:2', contentId: 42 }],
        [{ kind: 'vod', sourceId: 'playlist:1', contentId: 43 }],
    ] as const)(
        'changes when a logical movie identity changes: %o',
        (changedIdentity) => {
            const original = createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'playlist:1',
                contentId: 42,
            });

            expect(createPlaybackSessionKey(changedIdentity)).not.toBe(
                original
            );
        }
    );

    it.each([
        [
            'source',
            {
                kind: 'episode',
                sourceId: 'playlist:2',
                contentId: 42,
                seriesId: 7,
                seasonNumber: 3,
                episodeNumber: 4,
            },
        ],
        [
            'content',
            {
                kind: 'episode',
                sourceId: 'playlist:1',
                contentId: 43,
                seriesId: 7,
                seasonNumber: 3,
                episodeNumber: 4,
            },
        ],
        [
            'series',
            {
                kind: 'episode',
                sourceId: 'playlist:1',
                contentId: 42,
                seriesId: 8,
                seasonNumber: 3,
                episodeNumber: 4,
            },
        ],
        [
            'season',
            {
                kind: 'episode',
                sourceId: 'playlist:1',
                contentId: 42,
                seriesId: 7,
                seasonNumber: 4,
                episodeNumber: 4,
            },
        ],
        [
            'episode',
            {
                kind: 'episode',
                sourceId: 'playlist:1',
                contentId: 42,
                seriesId: 7,
                seasonNumber: 3,
                episodeNumber: 5,
            },
        ],
    ] as const)(
        'changes when the logical episode %s identity changes',
        (_field, changedIdentity) => {
            const original = createPlaybackSessionKey({
                kind: 'episode',
                sourceId: 'playlist:1',
                contentId: 42,
                seriesId: 7,
                seasonNumber: 3,
                episodeNumber: 4,
            });

            expect(createPlaybackSessionKey(changedIdentity)).not.toBe(
                original
            );
        }
    );

    it('does not expose a provider-scoped content-info adapter', () => {
        expect(playbackSessionKey).not.toHaveProperty(
            'createPlaybackSessionKeyFromContentInfo'
        );
    });
});
