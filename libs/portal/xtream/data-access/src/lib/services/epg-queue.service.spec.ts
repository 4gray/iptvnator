import { TestBed } from '@angular/core/testing';
import { EpgQueueService } from './epg-queue.service';
import { XtreamApiService } from './xtream-api.service';

describe('EpgQueueService', () => {
    let service: EpgQueueService;
    let xtreamApi: { getShortEpg: jest.Mock };

    const credentials = {
        serverUrl: 'https://xtream.example.com',
        username: 'user',
        password: 'pass',
    };

    beforeEach(() => {
        jest.useFakeTimers();

        xtreamApi = {
            getShortEpg: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                EpgQueueService,
                {
                    provide: XtreamApiService,
                    useValue: xtreamApi,
                },
            ],
        });

        service = TestBed.inject(EpgQueueService);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('caches empty EPG responses and does not immediately refetch them', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await (service as unknown as { fetchEpg: (credentials: typeof credentials, streamId: number) => Promise<void> }).fetchEpg(
            credentials,
            101
        );

        expect(service.getCached(101)).toEqual([]);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledWith(
            credentials,
            101,
            3,
            {
                suppressErrorLog: true,
            }
        );
        expect(
            (service as unknown as { shouldFetch: (streamId: number) => boolean }).shouldFetch(
                101
            )
        ).toBe(false);
    });

    it('applies a cooldown after EPG request failures', async () => {
        xtreamApi.getShortEpg.mockRejectedValue(new Error('EPG failed'));

        await (service as unknown as { fetchEpg: (credentials: typeof credentials, streamId: number) => Promise<void> }).fetchEpg(
            credentials,
            202
        );

        expect(
            (service as unknown as { shouldFetch: (streamId: number) => boolean }).shouldFetch(
                202
            )
        ).toBe(false);

        jest.advanceTimersByTime(60_001);

        expect(
            (service as unknown as { shouldFetch: (streamId: number) => boolean }).shouldFetch(
                202
            )
        ).toBe(true);
    });
});
