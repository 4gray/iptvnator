import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideSource,
} from './epg-guide-source';
import {
    EPG_GUIDE_LOAD_CHUNK,
    EpgGuideProgramsService,
} from './epg-guide-programs.service';

function channel(id: string, epgKey: string | null = id): EpgGuideChannel {
    return { id, number: 1, name: id, logoUrl: null, epgKey };
}

function programFor(channelId: string): EpgProgram {
    return {
        start: '2026-09-06T16:00:00.000Z',
        stop: '2026-09-06T17:00:00.000Z',
        channel: channelId,
        title: `${channelId} show`,
        desc: null,
        category: null,
    };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EpgGuideProgramsService', () => {
    const channels = signal<EpgGuideChannel[]>([]);
    const loadPrograms = jest.fn<Promise<Map<string, EpgProgram[]>>, [unknown]>();
    const loadCoverage = jest.fn<Promise<Set<string>>, [unknown]>();
    let service: EpgGuideProgramsService;

    beforeEach(() => {
        loadPrograms.mockReset();
        loadCoverage.mockReset();
        loadCoverage.mockResolvedValue(new Set());
        channels.set([channel('a'), channel('b'), channel('c', null)]);
        const source: EpgGuideSource = {
            channels,
            scopes: signal([]),
            scopeId: signal('all'),
            setScope: jest.fn(),
            loadPrograms,
            loadCoverage,
            activeChannelId: signal(null),
            activate: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                EpgGuideProgramsService,
                { provide: EPG_GUIDE_SOURCE, useValue: source },
            ],
        });
        service = TestBed.inject(EpgGuideProgramsService);
        // Consume the constructor effect's first run (a no-op by design) so
        // each test starts from a clean, predictable call count.
        TestBed.flushEffects();
    });

    it('reports "none" for channels without an EPG key and never requests them', async () => {
        loadPrograms.mockResolvedValue(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('c')).toBe('none');
        const requested = loadPrograms.mock.calls[0][0] as { channels: EpgGuideChannel[] };
        expect(requested.channels.map((item) => item.id)).toEqual(['a', 'b']);
    });

    it('loads visible rows once, in chunks, and exposes their programmes', async () => {
        const many = Array.from({ length: EPG_GUIDE_LOAD_CHUNK + 5 }, (_, i) =>
            channel(`ch-${i}`)
        );
        channels.set(many);
        loadPrograms.mockImplementation(async (window) => {
            const { channels: requested } = window as { channels: EpgGuideChannel[] };
            return new Map(requested.map((item) => [item.id, [programFor(item.id)]]));
        });
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(many);
        expect(service.statusFor('ch-0')).toBe('loading');
        await flush();
        expect(loadPrograms).toHaveBeenCalledTimes(2);
        expect(service.statusFor('ch-0')).toBe('loaded');
        expect(service.programsFor('ch-0')[0].title).toBe('ch-0 show');
        service.ensureLoaded(many);
        expect(loadPrograms).toHaveBeenCalledTimes(2);
    });

    it('drops responses that belong to a previous window', async () => {
        let resolveFirst!: (value: Map<string, EpgProgram[]>) => void;
        loadPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (resolveFirst = resolve))
        );
        loadPrograms.mockResolvedValueOnce(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        service.setWindow(3_000, 4_000);
        service.ensureLoaded(channels());
        resolveFirst(new Map([['a', [programFor('a')]]]));
        await flush();
        expect(service.programsFor('a')).toEqual([]);
    });

    it('marks a failed batch as loaded-empty instead of retrying on every scroll', async () => {
        loadPrograms.mockRejectedValue(new Error('ipc down'));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('a')).toBe('loaded');
        service.ensureLoaded(channels());
        expect(loadPrograms).toHaveBeenCalledTimes(1);
    });

    it('loads coverage for the whole scope when the window is set and answers isCovered', async () => {
        loadCoverage.mockResolvedValue(new Set(['a']));
        expect(service.coverageLoaded()).toBe(false);
        expect(service.isCovered('b')).toBe(true);
        service.setWindow(1_000, 2_000);
        await flush();
        expect(loadCoverage).toHaveBeenCalledTimes(1);
        expect(service.coverageLoaded()).toBe(true);
        expect(service.isCovered('a')).toBe(true);
        expect(service.isCovered('b')).toBe(false);
        expect(service.isCovered('c')).toBe(false);
    });

    it('resets programmes and coverage when the scope channels change', async () => {
        loadPrograms.mockResolvedValue(new Map([['a', [programFor('a')]]]));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.programsFor('a')).toHaveLength(1);
        const callsBefore = loadCoverage.mock.calls.length;
        channels.set([channel('a'), channel('z')]);
        TestBed.flushEffects();
        await flush();
        expect(service.statusFor('a')).toBe('idle');
        expect(loadCoverage.mock.calls.length).toBe(callsBefore + 1);
        const requested = loadCoverage.mock.calls[callsBefore][0] as {
            channels: EpgGuideChannel[];
        };
        const requestedIds = requested.channels.map((item) => item.id);
        expect(requestedIds).toContain('z');
        expect(requestedIds).not.toContain('b');
    });

    it('does not re-invalidate or drop an in-flight load when the effect flushes again with unchanged channels', async () => {
        loadPrograms.mockResolvedValue(new Map([['a', [programFor('a')]]]));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        TestBed.flushEffects();
        await flush();
        expect(loadCoverage).toHaveBeenCalledTimes(1);
        expect(service.programsFor('a')).toHaveLength(1);
    });

    it('leaves coverage unknown when a coverage chunk rejects', async () => {
        loadCoverage.mockRejectedValue(new Error('coverage down'));
        service.setWindow(1_000, 2_000);
        await flush();
        expect(service.coverageLoaded()).toBe(false);
        expect(service.isCovered('b')).toBe(true);
    });

    it('treats an empty-string epgKey the same as null', async () => {
        channels.set([channel('a'), channel('empty', '')]);
        loadPrograms.mockResolvedValue(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('empty')).toBe('none');
        const requestedPrograms = loadPrograms.mock.calls[0][0] as {
            channels: EpgGuideChannel[];
        };
        expect(requestedPrograms.channels.map((item) => item.id)).not.toContain(
            'empty'
        );
        const requestedCoverage = loadCoverage.mock.calls[0][0] as {
            channels: EpgGuideChannel[];
        };
        expect(requestedCoverage.channels.map((item) => item.id)).not.toContain(
            'empty'
        );
    });
});
