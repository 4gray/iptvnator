import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    let service: EpgService;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let snackBar: { open: jest.Mock };

    beforeEach(() => {
        epgBridge = {
            fetchEpg: jest.fn().mockResolvedValue({ success: true }),
            getChannelPrograms: jest.fn().mockResolvedValue([]),
            getCurrentProgramsBatch: jest.fn().mockResolvedValue({}),
            supportsCurrentProgramBatch: false,
            supportsImport: false,
            supportsProgramLookup: false,
        };
        snackBar = {
            open: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                    },
                },
            ],
        });

        service = TestBed.inject(EpgService);
    });

    it('does not fetch EPG when bridge import support is disabled', () => {
        service.fetchEpg(['https://example.com/epg.xml']);

        expect(epgBridge.fetchEpg).not.toHaveBeenCalled();
    });

    it('fetches EPG through the EPG runtime bridge when import support is enabled', () => {
        epgBridge.supportsImport = true;

        service.fetchEpg([
            'https://example.com/epg.xml',
            '',
            'https://example.com/other.xml',
        ]);

        expect(epgBridge.fetchEpg).toHaveBeenCalledWith([
            'https://example.com/epg.xml',
            'https://example.com/other.xml',
        ]);
    });

    it('does not show a fetch error when the bridge returns no result', async () => {
        epgBridge.supportsImport = true;
        (epgBridge.fetchEpg as jest.Mock).mockResolvedValue(null);

        service.fetchEpg(['https://example.com/epg.xml']);
        await Promise.resolve();

        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('returns an empty batch result when the desktop bridge is unavailable', async () => {
        const result = await firstValueFrom(
            service.getCurrentProgramsForChannels(['channel-1'])
        );

        expect(result).toEqual(new Map());
        expect(epgBridge.getCurrentProgramsBatch).not.toHaveBeenCalled();
    });

    it('returns null for current program lookup when the desktop bridge is unavailable', async () => {
        await expect(
            firstValueFrom(service.getCurrentProgramForChannel('channel-1'))
        ).resolves.toBeNull();
        expect(epgBridge.getChannelPrograms).not.toHaveBeenCalled();
    });

    it('uses the EPG runtime bridge for current program lookup when supported', async () => {
        epgBridge.supportsProgramLookup = true;
        epgBridge.getChannelPrograms = jest.fn().mockResolvedValue([
            {
                channel: 'channel-1',
                start: '2026-05-23T10:00:00.000Z',
                stop: '2026-05-23T11:00:00.000Z',
                title: 'Morning News',
            },
        ]);
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));

        await expect(
            firstValueFrom(service.getCurrentProgramForChannel('channel-1'))
        ).resolves.toMatchObject({ title: 'Morning News' });

        expect(epgBridge.getChannelPrograms).toHaveBeenCalledWith('channel-1');
        jest.useRealTimers();
    });
});
