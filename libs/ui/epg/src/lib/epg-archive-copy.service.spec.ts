import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { EpgArchiveCopyService } from './epg-archive-copy.service';

describe('EpgArchiveCopyService', () => {
    const copy = jest.fn();
    const open = jest.fn();
    let service: EpgArchiveCopyService;
    beforeEach(() => {
        copy.mockReset().mockReturnValue(true);
        open.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: Clipboard, useValue: { copy } },
                { provide: MatSnackBar, useValue: { open } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(EpgArchiveCopyService);
    });
    it('copies the resolved URL and reports success', async () => {
        await service.copy(() =>
            Promise.resolve('https://provider.test/archive.ts')
        );
        expect(copy).toHaveBeenCalledWith('https://provider.test/archive.ts');
        expect(open).toHaveBeenCalledWith(
            'EPG.PROGRAM_DIALOG.ARCHIVE_URL_COPIED',
            undefined,
            { duration: 4000 }
        );
    });
    it.each([null, '', 'javascript:alert(1)'])(
        'rejects an unavailable or unsafe URL: %s',
        async (url) => {
            await service.copy(() => url);
            expect(copy).not.toHaveBeenCalled();
            expect(open).toHaveBeenCalledWith(
                'EPG.PROGRAM_DIALOG.ARCHIVE_URL_FAILED',
                undefined,
                { duration: 4000 }
            );
        }
    );
    it('handles resolver and clipboard failures without exposing their messages', async () => {
        await service.copy(() => {
            throw new Error('https://user:secret@provider.test');
        });
        copy.mockReturnValue(false);
        await service.copy(() => 'https://provider.test/archive.ts');
        expect(open.mock.calls.map(([key]) => key)).toEqual([
            'EPG.PROGRAM_DIALOG.ARCHIVE_URL_FAILED',
            'EPG.PROGRAM_DIALOG.ARCHIVE_URL_FAILED',
        ]);
    });
    it.each([false, true])(
        'lets a new copy replace a slow request (old failure: %s)',
        async (failOld) => {
            let finish!: (url: string) => void;
            let reject!: (error: Error) => void;
            const first = service.copy(
                () =>
                    new Promise<string>((resolve, fail) => {
                        finish = resolve;
                        reject = fail;
                    })
            );
            const latest = jest.fn(async () => 'https://provider.test/new.ts');
            await service.copy(latest);
            expect(latest).toHaveBeenCalledTimes(1);
            if (failOld) reject(new Error('secret old request'));
            else finish('https://provider.test/old.ts');
            await first;
            expect(copy.mock.calls).toEqual([['https://provider.test/new.ts']]);
            expect(open).toHaveBeenCalledTimes(1);
        }
    );
    it('discards an old result even while the newer request is still pending', async () => {
        let finishOld!: (url: string) => void,
            finishNew!: (url: string) => void;
        const first = service.copy(
            () =>
                new Promise<string>((resolve) => {
                    finishOld = resolve;
                })
        );
        const second = service.copy(
            () =>
                new Promise<string>((resolve) => {
                    finishNew = resolve;
                })
        );
        finishOld('https://provider.test/old.ts');
        await first;
        expect(copy).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        finishNew('https://provider.test/new.ts');
        await second;
        expect(copy).toHaveBeenCalledWith('https://provider.test/new.ts');
    });
});
