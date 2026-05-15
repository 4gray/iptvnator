import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    let service: EpgService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                EpgService,
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
