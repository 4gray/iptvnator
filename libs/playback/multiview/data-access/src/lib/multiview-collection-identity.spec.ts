import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    pickerSessionKey,
    tileNumberFor,
} from './multiview-collection-identity';
import type { MultiviewTileSource } from './multiview-session.model';

const item = (
    contentType: UnifiedCollectionItem['contentType'],
    xtreamId = 7
): UnifiedCollectionItem => ({
    uid: `xtream::p1::${contentType}:${xtreamId}`,
    name: 'Synthetic',
    contentType,
    sourceType: 'xtream',
    playlistId: 'p1',
    playlistName: 'Synthetic Provider',
    xtreamId,
});

const tile = (
    overrides: Partial<MultiviewTileSource>
): MultiviewTileSource => ({
    playback: { streamUrl: 'https://stream.example/x.mkv', title: 't' },
    playbackSessionKey: 'other',
    kind: 'vod',
    playlistId: 'p1',
    title: 't',
    ...overrides,
});

describe('multiview collection identity', () => {
    it('keeps a film and a series with the same provider id apart', () => {
        expect(pickerSessionKey(item('movie'))).not.toBe(
            pickerSessionKey(item('series'))
        );
    });

    it('never counts a series as the film tile with its provider id', () => {
        const film = tile({ contentId: '7' });

        expect(tileNumberFor(item('movie'), [film])).toBe(1);
        expect(tileNumberFor(item('series'), [film])).toBeNull();
    });
});
