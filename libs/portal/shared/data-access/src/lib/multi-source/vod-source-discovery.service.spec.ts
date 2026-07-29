import { VodSourceDiscoveryService } from './vod-source-discovery.service';

/**
 * Discovery talks to a foreign playlist, and Xtream carries the account in the
 * URL — so anything it fails on has to go through the redacting logger before
 * it reaches the console.
 */
describe('VodSourceDiscoveryService — failure logging', () => {
    const CREDENTIAL_URL =
        'http://portal.example.com:8080/player_api.php' +
        '?username=alice&password=hunter2&action=get_vod_info';

    let warnSpy: jest.SpyInstance;
    let service: VodSourceDiscoveryService;

    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
            /* captured */
        });
        service = new VodSourceDiscoveryService();
    });

    afterEach(() => {
        warnSpy.mockRestore();
        delete (window as { electron?: unknown }).electron;
    });

    it('never lets a portal error carry credentials to the console', async () => {
        (window as { electron?: unknown }).electron = {
            dbFindTitleSources: jest
                .fn()
                .mockRejectedValue(
                    new Error(`Request to ${CREDENTIAL_URL} failed`)
                ),
        };

        await expect(
            service.discover({
                title: 'Dune',
                currentPlaylistId: 'playlist-1',
            })
        ).resolves.toEqual({ sources: [], matchKind: 'title-year' });

        expect(warnSpy).toHaveBeenCalled();
        const logged = loggedText();
        expect(logged).not.toContain('hunter2');
        expect(logged).not.toContain('alice');
        // Still useful: the failure is reported, only the account is not.
        expect(logged).toContain('VOD source discovery failed');
    });

    /**
     * What a console would actually show.
     *
     * `JSON.stringify` on an Error yields `{}` — its message and stack are
     * non-enumerable — so stringifying the call list would hide a raw error's
     * credentials and quietly pass whatever this asserts.
     */
    function loggedText(): string {
        return warnSpy.mock.calls
            .flat()
            .map((arg) => {
                if (arg instanceof Error) {
                    return `${arg.message}\n${arg.stack ?? ''}`;
                }
                return typeof arg === 'string' ? arg : JSON.stringify(arg);
            })
            .join('\n');
    }
});
