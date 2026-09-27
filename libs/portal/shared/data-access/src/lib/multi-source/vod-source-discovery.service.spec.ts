import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ParentalLockService } from '@iptvnator/services';
import { VodSourceDiscoveryService } from './vod-source-discovery.service';

const withholdsEverything = signal(false);

function createService(): VodSourceDiscoveryService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            {
                provide: ParentalLockService,
                useValue: { withholdsEverything },
            },
        ],
    });
    return TestBed.inject(VodSourceDiscoveryService);
}

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
        service = createService();
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

describe('VodSourceDiscoveryService — candidate mapping', () => {
    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
    });

    it('derives the category language, leaving conflicts and noise empty', async () => {
        (window as { electron?: unknown }).electron = {
            dbFindTitleSources: jest
                .fn()
                .mockResolvedValue([
                    row(1, ['EN | Netflix', 'EN | Action']),
                    row(2, ['EN | Netflix', 'DE | Cinema']),
                    row(3, ['TOP | 250']),
                    row(4, undefined),
                ]),
        };
        const service = createService();

        const result = await service.discover({
            title: 'Dune',
            currentPlaylistId: 'playlist-0',
        });

        expect(result.sources.map((source) => source.categoryLanguage)).toEqual(
            ['EN', null, null, null]
        );
    });

    function row(id: number, categoryNames: string[] | undefined) {
        return {
            playlistId: `playlist-${id}`,
            playlistName: `Portal ${id}`,
            categoryId: id,
            xtreamId: 100 + id,
            title: 'Dune',
            posterUrl: null,
            matchConfidence: 'exact' as const,
            year: null,
            categoryNames,
        };
    }
});

describe('VodSourceDiscoveryService — parental lock', () => {
    afterEach(() => {
        withholdsEverything.set(false);
        delete (window as { electron?: unknown }).electron;
    });

    it('asks the worker nothing while the lock withholds everything', async () => {
        const dbFindTitleSources = jest.fn().mockResolvedValue([]);
        (window as { electron?: unknown }).electron = { dbFindTitleSources };
        withholdsEverything.set(true);

        const result = await createService().discover({
            title: 'Dune',
            currentPlaylistId: 'playlist-0',
        });

        expect(result.sources).toEqual([]);
        expect(dbFindTitleSources).not.toHaveBeenCalled();
    });
});
