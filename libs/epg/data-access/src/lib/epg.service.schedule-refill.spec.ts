import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subject, type Observable } from 'rxjs';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { EpgService } from './epg.service';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function program(channel: string, title: string): EpgProgram {
    return {
        channel,
        title,
        start: '2026-06-21T12:00:00.000Z',
        stop: '2026-06-21T13:00:00.000Z',
        desc: null,
        category: null,
    } as EpgProgram;
}

/**
 * The open channel's programme panel (`currentEpgPrograms$`) is read once
 * per channel switch; when the stored EPG changes it must be read again.
 */
describe('EpgService schedule refill', () => {
    let service: EpgService;
    let getChannelPrograms: jest.Mock;
    let onProgress: (progress: EpgImportProgress) => void;
    let sourcesChanged: Subject<void>;
    let shown: EpgProgram[][];
    let epgEnabled: boolean;
    const offsetMinutes = signal(0);

    beforeEach(() => {
        getChannelPrograms = jest.fn(async () => []);
        epgEnabled = true;
        offsetMinutes.set(0);
        sourcesChanged = new Subject<void>();
        const identity =
            () =>
            <T>(source: Observable<T>) =>
                source;
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsImport: true,
                        supportsProgress: true,
                        supportsProgramLookup: true,
                        fetchEpg: jest.fn(async () => ({ success: true })),
                        getChannelPrograms,
                        onProgress: (
                            callback: (progress: EpgImportProgress) => void
                        ) => (onProgress = callback),
                    },
                },
                {
                    provide: EpgPreferencesService,
                    useValue: { enabled: () => epgEnabled, guard: identity },
                },
                {
                    provide: EpgSourceSettingsService,
                    useValue: {
                        changed$: sourcesChanged,
                        guard: identity,
                        revision: () => 0,
                        waitForReconciliation: async () => undefined,
                        retainCurrentSources: (urls: string[]) => urls,
                        getFetchableSourceUrls: () => [],
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        loadSettings: async () => undefined,
                        getSettings: () => ({ epgUrl: [] }),
                        getTrustOptions: () => ({}),
                        resolvedEpgOffsetMinutes: offsetMinutes,
                    },
                },
                { provide: LazySnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(EpgService);
        shown = [];
        service.currentEpgPrograms$.subscribe((programs) =>
            shown.push(programs)
        );
    });

    afterEach(() => jest.restoreAllMocks());

    /** Opens a channel whose schedule is empty until the EPG arrives. */
    async function openChannel(channelId: string): Promise<void> {
        service.getChannelPrograms(channelId);
        await flush();
        getChannelPrograms.mockResolvedValue([program(channelId, 'Fresh')]);
    }

    it('reads the open channel again after an import of this page', async () => {
        await openChannel('news.example');

        await service.fetchEpg(['https://guide.example.com/epg.xml']);
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: true,
        });
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Fresh']);
    });

    it('reads it again when any import completes (refresh, retry, startup)', async () => {
        await openChannel('news.example');

        onProgress({
            url: 'https://guide.example.com/epg.xml',
            status: 'loading',
        } as EpgImportProgress);
        await flush();
        expect(getChannelPrograms).toHaveBeenCalledTimes(1);

        onProgress({
            url: 'https://guide.example.com/epg.xml',
            status: 'complete',
        } as EpgImportProgress);
        await flush();
        expect(getChannelPrograms).toHaveBeenCalledTimes(2);
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Fresh']);
    });

    it('reads it again after the EPG sources change', async () => {
        await openChannel('news.example');

        sourcesChanged.next();
        await flush();

        expect(getChannelPrograms).toHaveBeenCalledTimes(2);
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Fresh']);
    });

    it('reloads the open schedule when its offset changes and discards the old reply', async () => {
        let oldReply!: (programs: EpgProgram[]) => void;
        let newReply!: (programs: EpgProgram[]) => void;
        getChannelPrograms
            .mockImplementationOnce(
                () => new Promise((resolve) => (oldReply = resolve))
            )
            .mockImplementationOnce(
                () => new Promise((resolve) => (newReply = resolve))
            );

        service.getChannelPrograms('news.example');
        await flush();
        const now = Date.parse('2026-06-21T12:10:00Z');
        jest.spyOn(Date, 'now').mockReturnValue(now);
        offsetMinutes.set(720);
        TestBed.tick();
        oldReply([program('news.example', 'Uncorrected schedule')]);
        await flush();

        expect(getChannelPrograms).toHaveBeenCalledTimes(2);
        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: now - 12 * 60 * 60_000,
            rejectOnError: true,
        });
        expect(shown.flat()).toEqual([]);

        newReply([program('news.example', 'Corrected schedule')]);
        await flush();
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual([
            'Corrected schedule',
        ]);
    });

    it('reads it again after refreshEpgData (a mapping change)', async () => {
        await openChannel('news.example');

        service.refreshEpgData();
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: true,
        });
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Fresh']);
    });

    it('does not let a late read of the previous channel replace the open one', async () => {
        let resolveOld: (programs: EpgProgram[]) => void = () => undefined;
        getChannelPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (resolveOld = resolve))
        );
        service.getChannelPrograms('old.example');
        getChannelPrograms.mockResolvedValueOnce([
            program('new.example', 'New channel'),
        ]);
        service.getChannelPrograms('new.example');
        await flush();

        resolveOld([program('old.example', 'Old channel')]);
        await flush();

        expect(shown.at(-1)?.map(({ title }) => title)).toEqual([
            'New channel',
        ]);
    });

    it('discards the old read after zapping away and back', async () => {
        let finishOld!: (programs: EpgProgram[]) => void;
        let finishOther!: (programs: EpgProgram[]) => void;
        let finishNew!: (programs: EpgProgram[]) => void;
        getChannelPrograms
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishOld = resolve))
            )
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishOther = resolve))
            )
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishNew = resolve))
            );

        service.getChannelPrograms('news.example');
        await flush();
        service.getChannelPrograms('other.example');
        await flush();
        service.getChannelPrograms('news.example');
        await flush();

        finishOld([program('news.example', 'Old schedule')]);
        await flush();
        expect(shown.flat().map(({ title }) => title)).not.toContain(
            'Old schedule'
        );

        finishOther([program('other.example', 'Other schedule')]);
        finishNew([program('news.example', 'Fresh schedule')]);
        await flush();
        expect(shown.at(-1)?.map(({ title }) => title)).toEqual([
            'Fresh schedule',
        ]);
    });

    it('does not let a read from before a refill replace the refilled schedule', async () => {
        let resolveOld: (programs: EpgProgram[]) => void = () => undefined;
        getChannelPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (resolveOld = resolve))
        );
        service.getChannelPrograms('news.example');
        getChannelPrograms.mockResolvedValueOnce([
            program('news.example', 'Refilled'),
        ]);
        service.refreshEpgData();
        await flush();

        resolveOld([program('news.example', 'Stale')]);
        await flush();

        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Refilled']);
    });

    it('asks the backend to reject, not to answer [], on a refill', async () => {
        await openChannel('news.example');
        // A zap keeps the plain read: an unreadable database shows empty.
        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: false,
        });

        service.refreshEpgData();
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: true,
        });
    });

    it('retains the advertised catch-up window on a background refill', async () => {
        service.getChannelPrograms('news.example', 7);
        await flush();
        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: false,
            archiveDays: 7,
        });

        service.refreshEpgData();
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example', {
            nowMs: expect.any(Number),
            rejectOnError: true,
            archiveDays: 7,
        });
    });

    it('keeps the schedule and raises no toast when a background refill fails', async () => {
        await openChannel('news.example');
        getChannelPrograms.mockResolvedValueOnce([
            program('news.example', 'Shown'),
        ]);
        service.getChannelPrograms('news.example');
        await flush();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        getChannelPrograms.mockRejectedValueOnce(new Error('database busy'));

        service.refreshEpgData();
        await flush();

        expect(shown.at(-1)?.map(({ title }) => title)).toEqual(['Shown']);
        expect(TestBed.inject(LazySnackBar).open).not.toHaveBeenCalled();
    });

    it('does not bring back the previous channel after a channel without a key', async () => {
        await openChannel('news.example');
        service.clearSchedule();

        service.refreshEpgData();
        sourcesChanged.next();
        await flush();

        expect(getChannelPrograms).toHaveBeenCalledTimes(1);
        expect(shown.at(-1)).toEqual([]);
    });

    it('clears a reply that settles just as a keyless channel opens', async () => {
        let finish!: (programs: EpgProgram[]) => void;
        getChannelPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve))
        );
        service.getChannelPrograms('news.example');
        await flush();

        finish([program('news.example', 'Stale')]);
        service.clearSchedule();
        await flush();

        expect(shown.at(-1)).toEqual([]);
    });

    it('retries loading the schedule module on the next zap', async () => {
        const load = service.loadScheduleFeed;
        service.loadScheduleFeed = jest
            .fn(load)
            .mockRejectedValueOnce(
                new Error('Synthetic missing schedule chunk')
            );
        const log = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            service.getChannelPrograms('news.example');
            await flush();
            expect(getChannelPrograms).not.toHaveBeenCalled();

            getChannelPrograms.mockResolvedValueOnce([
                program('news.example', 'Recovered'),
            ]);
            service.getChannelPrograms('news.example');
            await flush();
            expect(shown.at(-1)?.map(({ title }) => title)).toEqual([
                'Recovered',
            ]);
        } finally {
            log.mockRestore();
        }
    });

    it('lets an opening read publish when the refill that overtook it fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let resolveOpening: (programs: EpgProgram[]) => void = () => undefined;
        getChannelPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (resolveOpening = resolve))
        );
        service.getChannelPrograms('news.example');
        getChannelPrograms.mockRejectedValueOnce(new Error('database busy'));
        service.refreshEpgData();
        await flush();

        resolveOpening([program('news.example', 'Opening read')]);
        await flush();

        expect(shown.at(-1)?.map(({ title }) => title)).toEqual([
            'Opening read',
        ]);
    });

    it('refills the channel opened while EPG was off once it is turned on', async () => {
        await openChannel('a.example');
        epgEnabled = false;
        sourcesChanged.next();
        service.getChannelPrograms('b.example');
        await flush();
        expect(getChannelPrograms).toHaveBeenCalledTimes(1);

        epgEnabled = true;
        sourcesChanged.next();
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('b.example', {
            nowMs: expect.any(Number),
            rejectOnError: true,
        });
    });

    it('clears the airing cache when an import completes before any channel was opened', () => {
        const clearCache = jest.spyOn(service, 'clearCache');

        onProgress({
            url: 'https://guide.example.com/epg.xml',
            status: 'complete',
        } as EpgImportProgress);

        expect(clearCache).toHaveBeenCalled();
        expect(getChannelPrograms).not.toHaveBeenCalled();
    });

    it('does nothing before a channel was opened', async () => {
        service.refreshEpgData();
        sourcesChanged.next();
        await flush();

        expect(getChannelPrograms).not.toHaveBeenCalled();
    });
});
