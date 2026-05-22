import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    let service: EpgService;
    let runtimeCapabilities: { supportsEpg: boolean };
    const originalElectron = window.electron;

    beforeEach(() => {
        runtimeCapabilities = { supportsEpg: false };

        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
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

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('does not fetch EPG when runtime EPG support is disabled', () => {
        const fetchEpg = jest.fn();
        window.electron = {
            ...window.electron,
            fetchEpg,
        } as unknown as typeof window.electron;

        service.fetchEpg(['https://example.com/epg.xml']);

        expect(fetchEpg).not.toHaveBeenCalled();
    });

    it('fetches EPG through the Electron bridge when runtime EPG support is enabled', () => {
        const fetchEpg = jest.fn().mockResolvedValue({ success: true });
        window.electron = {
            ...window.electron,
            fetchEpg,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;

        service.fetchEpg([
            'https://example.com/epg.xml',
            '',
            'https://example.com/other.xml',
        ]);

        expect(fetchEpg).toHaveBeenCalledWith([
            'https://example.com/epg.xml',
            'https://example.com/other.xml',
        ]);
    });

    it('returns an empty batch result when the desktop bridge is unavailable', async () => {
        const result = await firstValueFrom(
            service.getCurrentProgramsForChannels(['channel-1'])
        );

        expect(result).toEqual(new Map());
    });

    it('returns null for current program lookup when the desktop bridge is unavailable', async () => {
        await expect(
            firstValueFrom(service.getCurrentProgramForChannel('channel-1'))
        ).resolves.toBeNull();
    });
});
