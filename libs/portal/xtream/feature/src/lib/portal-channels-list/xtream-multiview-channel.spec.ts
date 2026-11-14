import { xtreamMultiviewChannelItem } from './xtream-multiview-channel';

describe('xtreamMultiviewChannelItem', () => {
    const playlist = { id: 'playlist-1', name: 'Synthetic Provider' };

    it('maps a stored row with the provider category the lock keys by', () => {
        expect(
            xtreamMultiviewChannelItem(playlist, [{ id: 12, xtream_id: 340 }], {
                xtream_id: 7,
                title: 'Synthetic Channel 7',
                category_id: 12,
                stream_icon: 'https://logo.example/7.png',
            })
        ).toEqual({
            uid: 'xtream::playlist-1::live:7',
            name: 'Synthetic Channel 7',
            logo: 'https://logo.example/7.png',
            sourceType: 'xtream',
            contentType: 'live',
            playlistId: 'playlist-1',
            playlistName: 'Synthetic Provider',
            xtreamId: 7,
            categoryId: 340,
            tvArchive: null,
        });
    });

    it('keeps an API row category that is already the provider id', () => {
        expect(
            xtreamMultiviewChannelItem(playlist, [], {
                xtream_id: 7,
                name: 'Synthetic Channel 7',
                category_id: '55',
            })?.categoryId
        ).toBe('55');
    });

    it.each([
        ['no playlist', null, { xtream_id: 7 }],
        ['a film row', playlist, { xtream_id: 7, type: 'movie' as const }],
        ['a row without a stream id', playlist, { xtream_id: Number.NaN }],
    ])('maps nothing for %s', (_label, current, row) => {
        expect(xtreamMultiviewChannelItem(current, [], row)).toBeNull();
    });
});
