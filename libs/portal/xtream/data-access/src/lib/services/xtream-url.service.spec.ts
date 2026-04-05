import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SettingsStore } from 'services';
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
});
