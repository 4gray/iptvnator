import {
    fetchPlaylistFromUrl,
    PLAYLIST_FETCH_TIMEOUT_MS,
} from './playlist-source';

const mockRequestWithValidatedRedirects = jest.fn();

jest.mock('@iptvnator/shared/m3u-utils', () => ({
    createPlaylistObject: jest.fn(() => ({ title: 'Synthetic' })),
    getFilenameFromUrl: jest.fn(() => 'slow.m3u'),
}));

jest.mock('iptv-playlist-parser', () => ({
    parse: jest.fn(() => ({ items: [] })),
}));

jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: jest.fn(() => jest.fn()),
}));

jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: (...args: unknown[]) =>
        mockRequestWithValidatedRedirects(...args),
}));

describe('playlist download timeout', () => {
    beforeEach(() => mockRequestWithValidatedRedirects.mockReset());

    it('allows a provider two minutes of silence per hop', () => {
        expect(PLAYLIST_FETCH_TIMEOUT_MS).toBe(120_000);
    });

    it('passes the playlist budget to the download request', async () => {
        mockRequestWithValidatedRedirects.mockResolvedValue({
            data: '#EXTM3U',
        });

        await fetchPlaylistFromUrl('https://example.test/slow.m3u');

        expect(mockRequestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://example.test/slow.m3u',
            expect.objectContaining({ method: 'GET', timeout: 120_000 }),
            { allowPrivateNetworks: true }
        );
    });
});
