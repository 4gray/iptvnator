import {
    playlistRefreshMatchesSource,
    retainPlaylistRefreshSource,
} from './playlist-refresh-source.util';

describe('M3U refresh connection authority', () => {
    const current = { url: 'https://new.test/list', userAgent: 'New agent' };
    it.each([
        { url: 'https://old.test/list' },
        { userAgent: undefined },
        { filePath: '/old/device/path' },
    ])('rejects a captured superseded connection (%j)', (captured) => {
        expect(playlistRefreshMatchesSource(current, captured)).toBe(false);
    });
    it('accepts sparse legacy payloads and equivalent trimmed request fields', () => {
        expect(playlistRefreshMatchesSource(current, {})).toBe(true);
        expect(
            playlistRefreshMatchesSource(current, {
                url: ` ${current.url} `,
                userAgent: current.userAgent,
            })
        ).toBe(true);
    });
    it('retains connection/name metadata without contributing payload or activity', () => {
        expect(
            retainPlaylistRefreshSource({
                ...current,
                title: 'User title',
                referrer: 'https://referrer.test',
            })
        ).toEqual({
            ...current,
            title: 'User title',
            referrer: 'https://referrer.test',
            origin: undefined,
            filePath: undefined,
        });
        expect(retainPlaylistRefreshSource(undefined)).toEqual({});
    });
});
