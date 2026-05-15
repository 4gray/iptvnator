import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SettingsStore } from '@iptvnator/services';
import { XtreamCredentials } from './xtream-api.service';
import { XtreamUrlService } from './xtream-url.service';

describe('XtreamUrlService', () => {
    let service: XtreamUrlService;
    let databaseService: {
        getAppState: jest.Mock<Promise<string | null>, [string]>;
        setAppState: jest.Mock<Promise<void>, [string, string]>;
    };

    const credentials: XtreamCredentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };
    const originalElectron = window.electron;

    beforeEach(() => {
        databaseService = {
            getAppState: jest.fn().mockResolvedValue(null),
            setAppState: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                XtreamUrlService,
                { provide: DatabaseService, useValue: databaseService },
                {
                    provide: SettingsStore,
                    useValue: {
                        streamFormat: signal('ts'),
                    },
                },
            ],
        });

        service = TestBed.inject(XtreamUrlService);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('detects the legacy catchup scheme once and then uses the cached result', async () => {
        const xtreamProbeUrl = jest
            .fn()
            .mockResolvedValueOnce({ status: 404 })
            .mockResolvedValueOnce({ status: 302 });
        window.electron = {
            xtreamProbeUrl,
        } as typeof window.electron;

        const firstUrl = await service.resolveCatchupUrl(
            'playlist-1',
            credentials,
            101,
            1775296800,
            1775300400
        );
        const secondUrl = await service.resolveCatchupUrl(
            'playlist-1',
            credentials,
            101,
            1775296800,
            1775300400
        );

        expect(firstUrl).toContain('/streaming/timeshift.php?');
        expect(secondUrl).toBe(firstUrl);
        expect(xtreamProbeUrl).toHaveBeenCalledTimes(2);
        expect(databaseService.setAppState).toHaveBeenCalledWith(
            'xtream-catchup-scheme:playlist-1',
            'legacy'
        );
    });

    describe('formatCatchupStartTime (via constructCatchupUrl)', () => {
        // 2025-03-01 02:00:00 UTC = 2025-02-28 21:00:00 America/New_York
        const timestamp = 1740794400;

        it('formats time in the server timezone when provided', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest',
                'America/New_York'
            );
            expect(url).toContain('2025-02-28:21-00');
        });

        it('falls back to client local time when no timezone is given', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest'
            );
            const date = new Date(timestamp * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
            expect(url).toContain(expected);
        });

        it('falls back to client local time when an invalid timezone string is given', () => {
            const url = service.constructCatchupUrl(
                credentials,
                101,
                timestamp,
                timestamp + 3600,
                'rest',
                'UTC+5'
            );
            const date = new Date(timestamp * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            const expected = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
            expect(url).toContain(expected);
        });
    });
});
