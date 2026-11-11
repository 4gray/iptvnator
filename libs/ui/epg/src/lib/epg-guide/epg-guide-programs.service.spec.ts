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
    const loadPrograms = jest.fn<
        Promise<Map<string, EpgProgram[]>>,
        [unknown]
    >();
    const loadCoverage = jest.fn<
        Promise<Set<string>>,
        Parameters<EpgGuideSource['loadCoverage']>
    >();
    let service: EpgGuideProgramsService;
    let source: EpgGuideSource;
    const revision = signal(0);

    beforeEach(() => {
        loadPrograms.mockReset();
        loadCoverage.mockReset();
        loadCoverage.mockResolvedValue(new Set());
        channels.set([channel('a'), channel('b'), channel('c', null)]);
        revision.set(0);
        source = {
            channels,
            scopes: signal([]),
            scopeId: signal('all'),
            setScope: jest.fn(),
            loadPrograms,
            loadCoverage,
            activeChannelId: signal(null),
            activate: jest.fn(),
            revision,
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

    it('checks deferred coverage only on request and aborts a cancelled scan', async () => {
        Object.assign(source, { deferredCoverage: true });
        let resolve!: (ids: Set<string>) => void;
        loadCoverage.mockImplementation(
            () => new Promise((done) => (resolve = done))
        );
        service.setWindow(1000, 2000);
        expect(loadCoverage).not.toHaveBeenCalled();
        service.setCoverageRequested(true);
        expect(loadCoverage).toHaveBeenCalledTimes(1);
        expect(service.coverageStatus()).toBe('loading');
        const request = loadCoverage.mock.calls[0][0] as {
            signal: AbortSignal;
        };
        service.setCoverageRequested(false);
        expect(request.signal.aborted).toBe(true);
        resolve(new Set(['a']));
        await flush();
        expect(service.coverageLoaded()).toBe(false);
        expect(service.isCovered('b')).toBe(true);
    });

    it('uses the coverage scan to recover a visible failed row without fetching it again', async () => {
        Object.assign(source, { deferredCoverage: true });
        loadPrograms.mockResolvedValue(new Map());
        service.setWindow(1000, 2000);
        service.ensureLoaded([channels()[0]]);
        await flush();
        expect(service.statusFor('a')).toBe('error');

        const programme = programFor('a');
        loadCoverage.mockImplementation(async (_window, report) => {
            report?.('a', [programme]);
            return new Set(['a']);
        });
        service.setCoverageRequested(true);
        await flush();
        expect(service.programsFor('a')).toEqual([programme]);
        expect(service.statusFor('a')).toBe('loaded');
        expect(loadPrograms).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])(
        'shows an incomplete scan and applies a successful retry (scan first: %s)',
        async (scanFirst) => {
            Object.assign(source, { deferredCoverage: true });
            let finish!: (ids: Set<string>) => void;
            loadCoverage.mockImplementation(
                (_window, report) =>
                    new Promise((resolve) => {
                        report?.('a', null);
                        report?.('b', []);
                        finish = resolve;
                    })
            );
            service.setWindow(1000, 2000);
            service.setCoverageRequested(true);
            if (scanFirst) {
                finish(new Set(['a']));
                await flush();
                expect(service.coverageStatus()).toBe('error');
                expect(service.isCovered('a')).toBe(true);
                expect(service.isCovered('b')).toBe(false);
            }

            loadPrograms.mockResolvedValue(new Map([['a', []]]));
            service.ensureLoaded([channels()[0]]);
            await flush();
            if (!scanFirst) {
                finish(new Set(['a']));
                await flush();
            }
            expect(service.coverageStatus()).toBe('idle');
            expect(service.isCovered('a')).toBe(false);
        }
    );

    it('aborts visible-row work and invalidates cached programmes after a source revision', async () => {
        let finish!: (programs: Map<string, EpgProgram[]>) => void;
        loadPrograms
            .mockResolvedValueOnce(new Map([['a', [programFor('a')]]]))
            .mockImplementationOnce(
                () => new Promise((resolve) => (finish = resolve))
            );
        service.setWindow(1000, 2000);
        service.ensureLoaded([channels()[0]]);
        await flush();
        expect(service.programsFor('a')).toHaveLength(1);
        service.ensureLoaded([channels()[1]]);
        const request = loadPrograms.mock.calls[1][0] as {
            signal: AbortSignal;
        };
        revision.update((value) => value + 1);
        TestBed.flushEffects();
        expect(request.signal.aborted).toBe(true);
        finish(new Map([['b', [programFor('b')]]]));
        await flush();
        expect(service.programsFor('a')).toEqual([]);
        expect(service.programsFor('b')).toEqual([]);
        expect(service.statusFor('a')).toBe('idle');
    });

    it('retires pending per-stream requests when the rows scroll out of range', async () => {
        Object.assign(source, { programBatchSize: 1 });
        let finish!: (programs: Map<string, EpgProgram[]>) => void;
        loadPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve))
        );
        loadPrograms.mockResolvedValue(new Map([['b', [programFor('b')]]]));
        service.setWindow(1000, 2000);
        service.ensureLoaded([channels()[0]]);
        const first = loadPrograms.mock.calls[0][0] as { signal: AbortSignal };
        service.ensureLoaded([channels()[1]]);
        finish(new Map([['a', [programFor('a')]]]));
        await flush();
        expect(first.signal.aborted).toBe(true);
        expect(service.statusFor('a')).toBe('idle');
        expect(service.programsFor('a')).toEqual([]);
        expect(service.programsFor('b')).toHaveLength(1);
    });

    it('drops completed per-stream rows outside the rendered range', async () => {
        Object.assign(source, {
            programBatchSize: 1,
            programsExpireAt: () => Infinity,
        });
        const [first, second] = channels();
        loadPrograms
            .mockResolvedValueOnce(new Map([['a', [programFor('a')]]]))
            .mockResolvedValueOnce(new Map([['b', [programFor('b')]]]))
            .mockResolvedValueOnce(new Map([['a', [programFor('a')]]]));
        service.setWindow(1000, 2000);
        service.ensureLoaded([first]);
        await flush();
        expect(service.statusFor('a')).toBe('loaded');
        service.ensureLoaded([second]);
        await flush();
        expect(service.programsFor('a')).toEqual([]);
        expect(service.statusFor('a')).toBe('idle');
        expect(service.programsFor('b')).toHaveLength(1);
        service.ensureLoaded([first]);
        await flush();
        expect(service.programsFor('a')).toHaveLength(1);
        expect(loadPrograms).toHaveBeenCalledTimes(3);
    });

    it('reports "none" for channels without an EPG key and never requests them', async () => {
        loadPrograms.mockResolvedValue(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('c')).toBe('none');
        const requested = loadPrograms.mock.calls[0][0] as {
            channels: EpgGuideChannel[];
        };
        expect(requested.channels.map((item) => item.id)).toEqual(['a', 'b']);
    });

    it('loads visible rows once, in chunks, and exposes their programmes', async () => {
        const many = Array.from({ length: EPG_GUIDE_LOAD_CHUNK + 5 }, (_, i) =>
            channel(`ch-${i}`)
        );
        channels.set(many);
        loadPrograms.mockImplementation(async (window) => {
            const { channels: requested } = window as {
                channels: EpgGuideChannel[];
            };
            return new Map(
                requested.map((item) => [item.id, [programFor(item.id)]])
            );
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

    it('retries a failed row when it returns to the viewport without retrying visible rows repeatedly', async () => {
        loadPrograms.mockRejectedValue(new Error('ipc down'));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('a')).toBe('error');
        service.ensureLoaded(channels());
        expect(loadPrograms).toHaveBeenCalledTimes(1);
        service.ensureLoaded([]);
        loadPrograms.mockResolvedValue(new Map([['a', []]]));
        service.ensureLoaded([channels()[0]]);
        await flush();
        expect(loadPrograms).toHaveBeenCalledTimes(2);
        expect(service.statusFor('a')).toBe('loaded');
        expect(service.programsFor('a')).toEqual([]);
    });

    it('refreshes rendered rows after their provider cache entry expires', async () => {
        jest.useFakeTimers({ now: 1000 });
        try {
            const programsExpireAt = jest.fn().mockReturnValue(2000);
            Object.assign(source, { programsExpireAt });
            const row = channels()[0];
            loadPrograms
                .mockResolvedValueOnce(new Map([['a', []]]))
                .mockResolvedValueOnce(new Map([['a', [programFor('a')]]]));
            service.setWindow(1000, 2000);
            service.ensureLoaded([row]);
            await flush();
            service.ensureLoaded([row]);
            expect(loadPrograms).toHaveBeenCalledTimes(1);
            jest.setSystemTime(2000);
            programsExpireAt.mockReturnValue(3000);
            service.ensureLoaded([row]);
            await flush();
            expect(loadPrograms).toHaveBeenCalledTimes(2);
            expect(service.programsFor('a')).toEqual([programFor('a')]);
        } finally {
            jest.useRealTimers();
        }
    });

    it.each([true, false])(
        'removes a recovered empty row when coverage resolves first: %s',
        async (coverageFirst) => {
            Object.assign(source, {
                deferredCoverage: true,
                programBatchSize: 1,
            });
            let finishCoverage!: (ids: Set<string>) => void;
            loadCoverage.mockImplementation(
                () => new Promise((resolve) => (finishCoverage = resolve))
            );
            const row = channels()[0];
            loadPrograms
                .mockResolvedValueOnce(new Map())
                .mockResolvedValueOnce(new Map([['a', []]]));
            service.setWindow(1000, 2000);
            service.setCoverageRequested(true);
            service.ensureLoaded([row]);
            await flush();
            if (coverageFirst) {
                finishCoverage(new Set(['a']));
                await flush();
            }
            expect(service.isCovered('a')).toBe(true);
            service.ensureLoaded([]);
            service.ensureLoaded([row]);
            await flush();
            if (!coverageFirst) {
                service.ensureLoaded([]);
                finishCoverage(new Set(['a']));
                await flush();
            }
            expect(service.isCovered('a')).toBe(false);
        }
    );

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
        const requested = loadCoverage.mock.calls[callsBefore][0];
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
        const requestedCoverage = loadCoverage.mock.calls[0][0];
        expect(requestedCoverage.channels.map((item) => item.id)).not.toContain(
            'empty'
        );
    });
});
