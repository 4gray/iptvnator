import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { EpgPreferencesService, EpgSourceSettingsService } from '@iptvnator/services';
import { signal } from '@angular/core';
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
        getChannelPrograms: jest.Mock<Promise<EpgProgram[]>, [string]>;
        getCurrentProgramsBatch: jest.Mock<
            Promise<Record<string, EpgProgram | null>>,
            [string[], { nowMs?: number }?]
        >;
        getEpgChannels: jest.Mock<Promise<{ channels: Array<{ id: string; displayName: string }> }>, []>;
    };

    let bridge: Bridge;
    let epgOffsetMinutes = 0;
    let sourceRevision: ReturnType<typeof signal<number>>;
    const originalElectron = (window as { electron?: unknown }).electron;

    beforeEach(() => {
        epgOffsetMinutes = 0;
        sourceRevision = signal(0);
        bridge = {
            getChannelPrograms: jest.fn(),
            getCurrentProgramsBatch: jest.fn(),
            getEpgChannels: jest.fn(),
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
                    },
                },
                { provide: EpgPreferencesService, useValue: { enabled: () => true } },
                {
                    provide: EpgSourceSettingsService,
                    useValue: { revision: sourceRevision },
                },
            ],
        });
        return TestBed.inject(XtreamXmltvFallbackService);
    }

    it('uses uploaded XMLTV after provider failure and preserves the error when XMLTV is empty', async () => {
        const service = makeService();
        const providerError = new Error('Invalid full EPG listing');
        const fetchProvider = jest.fn().mockRejectedValue(providerError);
        const channel = 'sample.guide';
        bridge.getChannelPrograms
            .mockResolvedValueOnce([
                {
                    channel,
                    start: '2026-05-07T08:00:00Z',
                    stop: '2026-05-07T09:00:00Z',
                    title: 'Synthetic Programme',
                    desc: null,
                    category: null,
                },
            ])
            .mockResolvedValueOnce([]);
        const args = {
            epgChannelId: channel,
            preferUploaded: false,
            fetchProvider,
        };
        await expect(service.resolveCurrentEpg(args)).resolves.toEqual([
            expect.objectContaining({
                channel_id: channel,
                title: 'Synthetic Programme',
            }),
        ]);
        await expect(service.resolveCurrentEpg(args)).rejects.toBe(
            providerError
        );
    });

    it.each([true, false])(
        'reports unavailable XMLTV when the provider is empty (uploaded first: %s)',
        async (preferUploaded) => {
            const service = makeService();
            const error = new Error('XMLTV schedule unavailable');
            bridge.getChannelPrograms.mockRejectedValue(error);
            const fetchProvider = jest.fn().mockResolvedValue([]);
            const args = {
                epgChannelId: 'synthetic.channel',
                preferUploaded,
                fetchProvider,
            };
            await expect(service.resolveCurrentEpg(args)).rejects.toBe(error);
            expect(bridge.getChannelPrograms).toHaveBeenCalledWith(
                'synthetic.channel',
                { rejectOnError: true, nowMs: expect.any(Number) }
            );
            const items = [{ title: 'Synthetic Programme' }];
            fetchProvider.mockResolvedValue(items);
            await expect(service.resolveCurrentEpg(args)).resolves.toEqual(
                items
            );
        }
    );

    it('queries the XMLTV schedule in the provider clock with a display offset', async () => {
        const now = Date.parse('2026-05-07T20:00:00Z');
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
        try {
            epgOffsetMinutes = 720;
            bridge.getChannelPrograms.mockResolvedValue([]);
            await makeService().getProgramsForChannel('synthetic.channel', 7);

            expect(bridge.getChannelPrograms).toHaveBeenCalledWith(
                'synthetic.channel',
                {
                    rejectOnError: true,
                    nowMs: now - 720 * 60_000,
                    archiveDays: 7,
                }
            );
        } finally {
            clock.mockRestore();
        }
    });

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

    it('matches normalized channel names and rejects duplicate normalized names', async () => {
        const service = makeService();
        bridge.getEpgChannels.mockResolvedValue({ channels: [
            { id: 'xml.one', displayName: 'Bétá News HD' },
            { id: 'xml.two', displayName: 'Ambiguous Channel' },
            { id: 'xml.three', displayName: 'Ambiguous-Channel FHD' },
            { id: 'xml.four', displayName: 'DAZN LaLiga 1' },
            { id: 'xml.five', displayName: 'DAZN LaLiga 2' },
        ] });

        await expect(service.findChannelIdsByName([
            'Beta-News 4K', 'Ambiguous Channel', 'DAZN LaLiga 1 UHD', 'DAZN LaLiga 2 HD',
        ])).resolves.toEqual({
            'beta news': 'xml.one',
            'ambiguous channel': null,
            'dazn laliga 1': 'xml.four',
            'dazn laliga 2': 'xml.five',
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
    });

    it('matches attached separators and terminal quality suffixes flexibly', async () => {
        const service = makeService();
        bridge.getEpgChannels.mockResolvedValue({ channels: [
            { id: 'euro.unique', displayName: 'Eurosport 2' },
            { id: 'dazn.basket', displayName: 'DAZN Baloncesto 2' },
            { id: 'dazn.motogp', displayName: 'DAZN MotoGP' },
            { id: 'movistar.plus', displayName: 'Movistar Plus+' },
        ] });

        await expect(service.findChannelIdsByName([
            'DAZNBaloncesto2',
            'DAZN MOTO GP FULL HD',
            'Movistar Plus+ FULL HD',
            'EUROSPORT2HD',
        ])).resolves.toEqual({
            'daznbaloncesto2': 'dazn.basket',
            'dazn moto gp full': 'dazn.motogp',
            'movistar plus full': 'movistar.plus',
            'eurosport2hd': 'euro.unique',
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
    });

    it('rejects flexible matches with multiple IDs and keeps channel numbers distinct', async () => {
        const service = makeService();
        bridge.getEpgChannels.mockResolvedValue({ channels: [
            { id: 'euro.one', displayName: 'Eurosport 2' },
            { id: 'euro.two', displayName: 'Eurosport 2 HD' },
            { id: 'laliga.one', displayName: 'M+ LALIGA TV' },
            { id: 'laliga.two', displayName: 'M+ LaLiga TV HD' },
            { id: 'dazn.two', displayName: 'DAZN 2' },
        ] });

        await expect(service.findChannelIdsByName([
            'EUROSPORT2HD',
            'M+ LaLigaTVHD+',
            'DAZN1HD',
        ])).resolves.toEqual({
            'eurosport2hd': null,
            'm laligatvhd': null,
            'dazn1hd': null,
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['SPORT HD PLUS', 'SPORT PLUS'],
        ['SPORT PLUS', 'SPORT HD PLUS'],
    ])('rejects strict-key collisions with incompatible flexible candidates (%s first)', async (...names) => {
        const service = makeService();
        bridge.getEpgChannels.mockResolvedValue({ channels: [
            { id: 'sport.hd', displayName: 'SPORTHDPLUS' },
            { id: 'sport.base', displayName: 'SPORTPLUS' },
        ] });

        await expect(service.findChannelIdsByName(names)).resolves.toEqual({
            'sport plus': null,
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['EUROSPORT2HD', 'EUROSPORT2HD+'],
        ['EUROSPORT2HD+', 'EUROSPORT2HD'],
    ])('keeps the EUROSPORT2HD collision order-independent (%s first)', async (...names) => {
        const service = makeService();
        bridge.getEpgChannels.mockResolvedValue({ channels: [
            { id: 'euro.unique', displayName: 'Eurosport 2' },
        ] });

        await expect(service.findChannelIdsByName(names)).resolves.toEqual({
            'eurosport2hd': 'euro.unique',
        });
    });

    it('shares the pending name-index read and caches the normalized index for a source revision', async () => {
        const service = makeService();
        let finish!: (value: { channels: Array<{ id: string; displayName: string }> }) => void;
        bridge.getEpgChannels.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

        const first = service.findChannelIdsByName(['Channel One']);
        const second = service.findChannelIdsByName(['Channel Two']);
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);

        finish({ channels: [
            { id: 'guide.one', displayName: 'Channel One HD' },
            { id: 'guide.two', displayName: 'Channel Two' },
        ] });
        await expect(Promise.all([first, second])).resolves.toEqual([
            { 'channel one': 'guide.one' },
            { 'channel two': 'guide.two' },
        ]);
        await expect(service.findChannelIdsByName(['Channel One FHD'])).resolves.toEqual({
            'channel one': 'guide.one',
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(1);
    });

    it('reloads the name index after the EPG source revision changes', async () => {
        const service = makeService();
        bridge.getEpgChannels
            .mockResolvedValueOnce({ channels: [{ id: 'old.guide', displayName: 'Channel One' }] })
            .mockResolvedValueOnce({ channels: [{ id: 'new.guide', displayName: 'Channel One' }] });

        await expect(service.findChannelIdsByName(['Channel One'])).resolves.toEqual({
            'channel one': 'old.guide',
        });
        sourceRevision.update((revision) => revision + 1);
        await expect(service.findChannelIdsByName(['Channel One'])).resolves.toEqual({
            'channel one': 'new.guide',
        });
        expect(bridge.getEpgChannels).toHaveBeenCalledTimes(2);
    });
});
