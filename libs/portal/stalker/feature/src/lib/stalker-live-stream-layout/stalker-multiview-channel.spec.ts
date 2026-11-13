import { stalkerMultiviewChannelItem } from './stalker-multiview-channel';

describe('stalkerMultiviewChannelItem', () => {
    const playlist = { _id: 'portal-1', title: 'Synthetic Portal' };
    const channel = {
        id: 11,
        cmd: 'ffrt http://localhost/ch/11',
        name: 'Synthetic Channel 11',
        logo: 'https://logo.example/11.png',
        tv_genre_id: 3,
    };

    it('maps an ITV row for the resolver (create_link through its cmd)', () => {
        expect(stalkerMultiviewChannelItem(playlist, channel)).toEqual({
            uid: 'stalker::portal-1::11',
            name: 'Synthetic Channel 11',
            logo: 'https://logo.example/11.png',
            sourceType: 'stalker',
            contentType: 'live',
            playlistId: 'portal-1',
            playlistName: 'Synthetic Portal',
            stalkerId: 11,
            stalkerCmd: 'ffrt http://localhost/ch/11',
            stalkerItem: channel,
            categoryId: 3,
        });
    });

    it('marks radio rows so they never become tiles', () => {
        expect(
            stalkerMultiviewChannelItem(playlist, channel, true)?.radio
        ).toBe('true');
    });

    it('maps nothing without a playlist or a command', () => {
        expect(stalkerMultiviewChannelItem(null, channel)).toBeNull();
        expect(
            stalkerMultiviewChannelItem(playlist, { ...channel, cmd: '' })
        ).toBeNull();
    });
});
