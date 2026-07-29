import { signal } from '@angular/core';
import type { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
import { createVodSourceCounts } from './vod-multi-source-counts';

function source(
    id: string,
    playlistId: string,
    isActive = false
): VodSourceDescriptor {
    return {
        id,
        playlistId,
        playlistName: playlistId,
        portalType: 'xtream',
        contentId: 1,
        rawTitle: 'Example',
        matchConfidence: 'exact',
        year: null,
        isActive,
        isPinned: false,
        isTried: false,
        probe: { status: 'idle' },
    } as VodSourceDescriptor;
}

describe('createVodSourceCounts', () => {
    it('counts alternative streams for the chip', () => {
        const counts = createVodSourceCounts(
            signal([
                source('a', 'playlist-1', true),
                source('b', 'playlist-2'),
                source('c', 'playlist-2'),
            ])
        );

        expect(counts.alternativeCount()).toBe(2);
        expect(counts.hasAlternatives()).toBe(true);
    });

    it('counts OTHER playlists for the caption', () => {
        // The caption says "also found in N other playlists", so a playlist's
        // two copies are one playlist.
        const counts = createVodSourceCounts(
            signal([
                source('a', 'playlist-1', true),
                source('b', 'playlist-2'),
                source('c', 'playlist-2'),
            ])
        );

        expect(counts.alternativePlaylistCount()).toBe(1);
    });

    it('does not count the playlist being watched as another', () => {
        // Playing one of playlist-2's two copies leaves the other listed as an
        // alternative, which put playlist-2's own id in the set.
        const counts = createVodSourceCounts(
            signal([
                source('a', 'playlist-1'),
                source('b', 'playlist-2', true),
                source('c', 'playlist-2'),
            ])
        );

        expect(counts.alternativePlaylistCount()).toBe(1);
    });

    it('has nothing to offer for a single source', () => {
        const counts = createVodSourceCounts(
            signal([source('a', 'playlist-1', true)])
        );

        expect(counts.hasAlternatives()).toBe(false);
        expect(counts.alternativePlaylistCount()).toBe(0);
    });
});
