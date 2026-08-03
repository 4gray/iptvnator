import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { createUnifiedLivePlaybackSessionKey } from './unified-live-playback-session-key';

describe('createUnifiedLivePlaybackSessionKey', () => {
    it('keeps an M3U key across transport changes and separates channels', () => {
        const first = m3uItem({
            uid: 'm3u::pl-1::https://old.example/live.m3u8',
            streamUrl: 'https://old.example/live.m3u8',
            channelId: 'provider-channel-7',
        });
        const expected = createPlaybackSessionKey({
            kind: 'live',
            sourceId: 'pl-1',
            contentId: 'provider-channel-7',
        });

        expect(createUnifiedLivePlaybackSessionKey(first)).toBe(expected);
        expect(
            createUnifiedLivePlaybackSessionKey({
                ...first,
                uid: 'm3u::pl-1::https://new.example/timeshift.m3u8',
                streamUrl: 'https://new.example/timeshift.m3u8',
            })
        ).toBe(expected);
        expect(
            createUnifiedLivePlaybackSessionKey({
                ...first,
                channelId: 'provider-channel-8',
            })
        ).not.toBe(expected);
    });
});

function m3uItem(
    overrides: Partial<UnifiedCollectionItem>
): UnifiedCollectionItem {
    return {
        uid: 'm3u::pl-1::channel',
        name: 'Channel',
        contentType: 'live',
        sourceType: 'm3u',
        playlistId: 'pl-1',
        playlistName: 'Playlist',
        ...overrides,
    };
}
