import { TestBed } from '@angular/core/testing';
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
            [string[]]
        >;
    };

    let bridge: Bridge;
    const originalElectron = (window as { electron?: unknown }).electron;

    beforeEach(() => {
        bridge = {
            getChannelPrograms: jest.fn(),
            getCurrentProgramsBatch: jest.fn(),
        };
        (window as { electron?: Bridge }).electron = bridge;
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
            providers: [XtreamXmltvFallbackService],
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

        expect(bridge.getCurrentProgramsBatch).toHaveBeenCalledWith(['rtl.de']);
        expect(Object.keys(result)).toEqual(['rtl.de']);
    });

    it('returns [] when the bridge throws', async () => {
        const service = makeService();
        bridge.getChannelPrograms.mockRejectedValue(new Error('db down'));

        await expect(
            service.getProgramsForChannel('rtl.de')
        ).resolves.toEqual([]);
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
});
