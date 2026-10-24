import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

describe('XtreamXmltvFallbackService', () => {
    type Bridge = {
        getEpgChannels: jest.Mock;
        getEpgProgramCoverage: jest.Mock;
        getChannelPrograms: jest.Mock<Promise<EpgProgram[]>, [string]>;
        getCurrentProgramsBatch: jest.Mock<
            Promise<Record<string, EpgProgram | null>>,
            [string[], { nowMs?: number }?]
        >;
    };

    let bridge: Bridge;
    let epgOffsetMinutes = 0;
    let matchOrder: ['channel-name'|'tvg-name'|'tvg-id', 'channel-name'|'tvg-name'|'tvg-id', 'channel-name'|'tvg-name'|'tvg-id'] = ['channel-name','tvg-name','tvg-id'];
    const originalElectron = (window as { electron?: unknown }).electron;

    beforeEach(() => {
        epgOffsetMinutes = 0;
        matchOrder = ['channel-name','tvg-name','tvg-id'];
        bridge = {
            getEpgChannels: jest.fn().mockResolvedValue({channels: []}),
            getEpgProgramCoverage: jest.fn().mockResolvedValue([]),
            getChannelPrograms: jest.fn(),
            getCurrentProgramsBatch: jest.fn(),
        };
        (window as { electron?: unknown }).electron = bridge;
    });

    afterEach(() => {
        if (originalElectron === undefined) {
            delete (window as { electron?: unknown }).electron;
        } else {
            (window as { electron?: unknown }).electron = originalElectron;
        }
    });

    function makeService(): XtreamXmltvFallbackService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                XtreamXmltvFallbackService,
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgOffsetMinutes: () => epgOffsetMinutes,
                        resolvedEpgMatchOrder: () => matchOrder,
                    },
                },
            ],
        });
        return TestBed.inject(XtreamXmltvFallbackService);
    }

    it('returns [] when window.electron bridge is unavailable', async () => {
        delete (window as { electron?: unknown }).electron;
        const service = makeService();

        await expect(service.getProgramsForChannel('rtl.de')).resolves.toEqual(
            []
        );
        await expect(
            service.getCurrentProgramsBatch(['rtl.de'])
        ).resolves.toEqual({});
        expect(bridge.getChannelPrograms).not.toHaveBeenCalled();
        expect(bridge.getCurrentProgramsBatch).not.toHaveBeenCalled();
    });

    it('maps EpgProgram rows to EpgItem with timestamp pairs preserved', async () => {
        const service = makeService();
        const program: EpgProgram = {
            channel: 'rtl.de',
            start: '2026-05-07T08:00:00Z',
            stop: '2026-05-07T09:00:00Z',
            startTimestamp: 1778155200,
            stopTimestamp: 1778158800,
            title: 'Tagesschau',
            desc: 'News',
            category: null,
        };
        bridge.getChannelPrograms.mockResolvedValue([program]);

        const items = await service.getProgramsForChannel('rtl.de');

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            channel_id: 'rtl.de',
            title: 'Tagesschau',
            description: 'News',
            start: '2026-05-07T08:00:00Z',
            stop: '2026-05-07T09:00:00Z',
            end: '2026-05-07T09:00:00Z',
            start_timestamp: '1778155200',
            stop_timestamp: '1778158800',
        });
    });

    it('derives timestamps from ISO strings when startTimestamp is missing', async () => {
        const service = makeService();
        bridge.getChannelPrograms.mockResolvedValue([
            {
                channel: 'rtl.de',
                start: '2026-05-07T08:00:00Z',
                stop: '2026-05-07T09:00:00Z',
                title: 'X',
                desc: null,
                category: null,
            },
        ]);

        const items = await service.getProgramsForChannel('rtl.de');

        expect(Number(items[0].start_timestamp)).toBe(
            Math.floor(Date.parse('2026-05-07T08:00:00Z') / 1000)
        );
        expect(Number(items[0].stop_timestamp)).toBe(
            Math.floor(Date.parse('2026-05-07T09:00:00Z') / 1000)
        );
    });

    it('skips empty / nullish channel IDs in batch lookup', async () => {
        const service = makeService();
        bridge.getCurrentProgramsBatch.mockResolvedValue({
            'rtl.de': {
                channel: 'rtl.de',
                start: '2026-05-07T08:00:00Z',
                stop: '2026-05-07T09:00:00Z',
                title: 'Show',
                desc: null,
                category: null,
            },
        });

        const result = await service.getCurrentProgramsBatch([
            'rtl.de',
            '',
            null,
            undefined,
            '   ',
        ]);

        expect(bridge.getCurrentProgramsBatch).toHaveBeenCalledWith(
            ['rtl.de'],
            {
                nowMs: expect.any(Number),
            }
        );
        expect(Object.keys(result)).toEqual(['rtl.de']);
    });

    it('asks the bridge for programmes airing at the provider clock under a display offset', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));
        try {
            epgOffsetMinutes = 60;
            const service = makeService();
            bridge.getCurrentProgramsBatch.mockResolvedValue({});

            await service.getCurrentProgramsBatch(['rtl.de']);

            expect(bridge.getCurrentProgramsBatch).toHaveBeenCalledWith(
                ['rtl.de'],
                { nowMs: Date.parse('2026-05-23T09:30:00.000Z') }
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it('returns [] when the bridge throws', async () => {
        const service = makeService();
        bridge.getChannelPrograms.mockRejectedValue(new Error('db down'));

        await expect(service.getProgramsForChannel('rtl.de')).resolves.toEqual(
            []
        );
    });

    it('uses getChannelPrograms even when getCurrentProgramsBatch is missing', async () => {
        (window as { electron?: unknown }).electron = {
            getChannelPrograms: bridge.getChannelPrograms,
        };
        const service = makeService();
        bridge.getChannelPrograms.mockResolvedValue([
            {
                channel: 'rtl.de',
                start: '2026-05-07T08:00:00Z',
                stop: '2026-05-07T09:00:00Z',
                title: 'Tagesschau',
                desc: null,
                category: null,
            },
        ]);

        const items = await service.getProgramsForChannel('rtl.de');
        const batch = await service.getCurrentProgramsBatch(['rtl.de']);

        expect(items).toHaveLength(1);
        expect(batch).toEqual({});
    });

    it('uses getCurrentProgramsBatch even when getChannelPrograms is missing', async () => {
        (window as { electron?: unknown }).electron = {
            getCurrentProgramsBatch: bridge.getCurrentProgramsBatch,
        };
        const service = makeService();
        bridge.getCurrentProgramsBatch.mockResolvedValue({
            'rtl.de': {
                channel: 'rtl.de',
                start: '2026-05-07T08:00:00Z',
                stop: '2026-05-07T09:00:00Z',
                title: 'Now',
                desc: null,
                category: null,
            },
        });

        const items = await service.getProgramsForChannel('rtl.de');
        const batch = await service.getCurrentProgramsBatch(['rtl.de']);

        expect(items).toEqual([]);
        expect(Object.keys(batch)).toEqual(['rtl.de']);
    });
    describe('exact XMLTV channel name fallback', () => {
        it('recovers a mismatched Xtream EPG ID with the same channel name', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [{ id: 'playlist.a2.f39e', displayName: 'A2 HD' }],
            });
            const service = makeService();
            await expect(
                service.resolveExactXmltvChannelId('A2.tr', 'A2 HD')
            ).resolves.toBe('playlist.a2.f39e');
        });

        it('matches when the Xtream provider supplied no EPG ID', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [{ id: 'epg.a2', displayName: 'A2 HD' }],
            });
            await expect(
                makeService().resolveExactXmltvChannelId(null, ' a2 hd ')
            ).resolves.toBe('epg.a2');
        });

        it('prefers channel names over provider IDs by default', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [
                    { id: 'existing', displayName: 'Provider Channel' },
                    { id: 'other', displayName: 'A2 HD' },
                ],
            });
            await expect(
                makeService().resolveExactXmltvChannelId('existing', 'A2 HD')
            ).resolves.toBe('other');
        });

        it('honors explicit provider tvg-id-first matching', async () => {
            matchOrder = ['tvg-id', 'channel-name', 'tvg-name'];
            bridge.getEpgChannels.mockResolvedValue({
                channels: [
                    { id: 'existing', displayName: 'Provider Channel' },
                    { id: 'other', displayName: 'A2 HD' },
                ],
            });
            await expect(
                makeService().resolveExactXmltvChannelId('existing','A2 HD')
            ).resolves.toBe('existing');
        });

        it('chooses the first exact BEINSPORTS 1 HD ID even when all candidates are live', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [
                    { id: 'playlist.ligtvtr.88f04beb2605', displayName: 'BEINSPORTS 1 HD' },
                    { id: 'playlist.ligtvtr.2be172194bf4', displayName: 'BEINSPORTS 1 HD' },
                    { id: 'playlist.ligtvtr.6c12cd1eb0f7', displayName: 'BEINSPORTS 1 HD' },
                ],
            });
            bridge.getEpgProgramCoverage.mockResolvedValue([
                'playlist.ligtvtr.88f04beb2605',
                'playlist.ligtvtr.2be172194bf4',
                'playlist.ligtvtr.6c12cd1eb0f7',
            ]);
            await expect(makeService().resolveExactXmltvChannelId(
                'external.id', 'BEINSPORTS 1 HD'
            )).resolves.toBe('playlist.ligtvtr.88f04beb2605');
            expect(bridge.getEpgProgramCoverage).not.toHaveBeenCalled();
        });

        it('preserves source field priority when tvg-id comes first', async () => {
            matchOrder = ['tvg-id','channel-name','tvg-name'];
            bridge.getEpgChannels.mockResolvedValue({
                channels: [
                    { id: 'known.provider.id', displayName: 'Not BEIN' },
                    { id: 'first', displayName: 'BEINSPORTS 1 HD' },
                    { id: 'second', displayName: 'BEINSPORTS 1 HD' },
                ],
            });
            await expect(makeService().resolveExactXmltvChannelId(
                'known.provider.id','BEINSPORTS 1 HD'
            )).resolves.toBe('known.provider.id');
        });

        it('returns first exact from the cached channel list for concurrent Xtream rows', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [
                    { id: 'first', displayName: 'BEINSPORTS 1 HD' },
                    { id: 'second', displayName: 'BEINSPORTS 1 HD' },
                ],
            });
            const service = makeService();
            expect(await Promise.all([
                service.resolveExactXmltvChannelId(null, 'BEINSPORTS 1 HD'),
                service.resolveExactXmltvChannelId('wrong.provider', 'BEINSPORTS 1 HD'),
            ])).toEqual(['first','first']);
            expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
            expect(bridge.getEpgProgramCoverage).not.toHaveBeenCalled();
        });

        it('loads the imported XMLTV channel index only once per service instance', async () => {
            bridge.getEpgChannels.mockResolvedValue({
                channels: [{ id: 'a2', displayName: 'A2 HD' }],
            });
            const service = makeService();
            await service.resolveExactXmltvChannelId('provider', 'A2 HD');
            await service.resolveExactXmltvChannelId('provider', 'A2 HD');
            expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
        });
    });

});
