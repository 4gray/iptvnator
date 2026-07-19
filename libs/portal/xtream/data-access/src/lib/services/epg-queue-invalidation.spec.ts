import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { EpgQueueService } from './epg-queue.service';
import { XtreamApiService } from './xtream-api.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';
import type { EpgItem } from '@iptvnator/shared/interfaces';

/**
 * Covers EpgQueueService.invalidate(), used when a manual EPG mapping for a
 * stream changes. Split from epg-queue.service.spec.ts to keep both files
 * under the max-lines limit.
 */
describe('EpgQueueService invalidation', () => {
    let service: EpgQueueService;
    let xtreamApi: { getShortEpg: jest.Mock };

    const credentials = {
        serverUrl: 'https://xtream.example.com',
        username: 'user',
        password: 'pass',
    };

    type ServicePrivates = {
        fetchEpg: (
            credentials: typeof credentials,
            streamId: number
        ) => Promise<void>;
        shouldFetch: (streamId: number) => boolean;
        xmltvPreviewByStreamId: Map<number, EpgItem>;
        epgChannelByStreamId: Map<number, string>;
    };

    beforeEach(() => {
        xtreamApi = { getShortEpg: jest.fn().mockResolvedValue([]) };

        TestBed.configureTestingModule({
            providers: [
                EpgQueueService,
                { provide: XtreamApiService, useValue: xtreamApi },
                {
                    provide: XtreamXmltvFallbackService,
                    useValue: {
                        getProgramsForChannel: jest.fn().mockResolvedValue([]),
                        getCurrentProgramsBatch: jest.fn().mockResolvedValue({}),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        preferUploadedEpgOverXtream: jest.fn(() => false),
                    },
                },
            ],
        });

        service = TestBed.inject(EpgQueueService);
    });

    function priv(): ServicePrivates {
        return service as unknown as ServicePrivates;
    }

    function makeItem(channelId: string, title: string): EpgItem {
        return {
            id: `${channelId}|x`,
            epg_id: '',
            title,
            lang: '',
            start: '2026-05-07T08:00:00Z',
            end: '2026-05-07T09:00:00Z',
            stop: '2026-05-07T09:00:00Z',
            description: '',
            channel_id: channelId,
            start_timestamp: '0',
            stop_timestamp: '0',
        };
    }

    it('drops every cached artifact so the stream refetches', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([makeItem('rtl.de', 'Now')]);
        await priv().fetchEpg(credentials, 555);
        priv().epgChannelByStreamId.set(555, 'rtl.de');
        priv().xmltvPreviewByStreamId.set(555, makeItem('rtl.de', 'now'));

        expect(service.getCached(555)).not.toBeNull();
        expect(priv().shouldFetch(555)).toBe(false);

        service.invalidate(555);

        expect(service.getCached(555)).toBeNull();
        expect(priv().shouldFetch(555)).toBe(true);
        expect(priv().epgChannelByStreamId.has(555)).toBe(false);
        expect(priv().xmltvPreviewByStreamId.has(555)).toBe(false);
    });

    it('discards an in-flight result when invalidated mid-request', async () => {
        let resolveEpg!: (items: EpgItem[]) => void;
        xtreamApi.getShortEpg.mockReturnValue(
            new Promise<EpgItem[]>((resolve) => {
                resolveEpg = resolve;
            })
        );
        const emitted: number[] = [];
        const sub = service.epgResult$.subscribe(({ streamId }) =>
            emitted.push(streamId)
        );

        const fetchPromise = priv().fetchEpg(credentials, 707);
        // The user changes the mapping while the request is still running.
        service.invalidate(707);
        // The provider now returns the pre-change (stale) result.
        resolveEpg([makeItem('rtl.de', 'Stale')]);
        await fetchPromise;

        expect(service.getCached(707)).toBeNull();
        expect(emitted).not.toContain(707);
        sub.unsubscribe();
    });
});
