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

    beforeEach(() => {
        getChannelPrograms = jest.fn(async () => []);
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
                    useValue: { enabled: () => true, guard: identity },
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
                        resolvedEpgOffsetMinutes: () => 0,
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

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example');
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

    it('reads it again after refreshEpgData (a mapping change)', async () => {
        await openChannel('news.example');

        service.refreshEpgData();
        await flush();

        expect(getChannelPrograms).toHaveBeenLastCalledWith('news.example');
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

    it('lets an opening read publish when the refill that overtook it fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let resolveOpening: (programs: EpgProgram[]) => void = () =>
            undefined;
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

    it('does nothing before a channel was opened', async () => {
        service.refreshEpgData();
        sourcesChanged.next();
        await flush();

        expect(getChannelPrograms).not.toHaveBeenCalled();
    });
});
