import { PROVIDER_REQUEST_TIMEOUT_MS } from './host-guard';

describe('provider request timeouts', () => {
    it('gives playlist downloads the Electron budget of two minutes', () => {
        expect(PROVIDER_REQUEST_TIMEOUT_MS.playlist).toBe(120_000);
    });

    it('keeps the portal and EPG budgets unchanged', () => {
        expect(PROVIDER_REQUEST_TIMEOUT_MS).toEqual({
            backgroundPlaylist: 30_000,
            epg: 30_000,
            playlist: 120_000,
            stalker: 15_000,
            stalkerCreateLink: 30_000,
            xtream: 30_000,
        });
    });
});
