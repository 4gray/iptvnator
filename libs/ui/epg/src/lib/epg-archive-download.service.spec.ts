import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DownloadsService } from '@iptvnator/services';
import { TranslateService } from '@ngx-translate/core';
import { EpgArchiveDownloadService } from './epg-archive-download.service';

describe('archive download feedback', () => {
    const startDownload = jest.fn();
    const isAvailable = jest.fn();
    const open = jest.fn();
    const input = {
        playlistId: 'p',
        xtreamId: 1,
        title: 'News',
        catchup: {
            channelName: 'TV',
            startTimestamp: 1000,
            stopTimestamp: 2000,
        },
    };
    let service: EpgArchiveDownloadService;
    beforeEach(() => {
        startDownload.mockReset().mockResolvedValue({ success: true });
        isAvailable.mockReset().mockReturnValue(true);
        open.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: DownloadsService,
                    useValue: { startDownload, isAvailable },
                },
                { provide: MatSnackBar, useValue: { open } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(EpgArchiveDownloadService);
    });
    it('passes the captured programme and resolved URL to the download manager', async () => {
        await service.start(input, async () => 'https://host/archive.ts');
        expect(startDownload).toHaveBeenCalledWith({
            ...input,
            url: 'https://host/archive.ts',
            contentType: 'catchup',
        });
        expect(open).toHaveBeenCalledWith(
            'EPG.PROGRAM_DIALOG.ARCHIVE_DOWNLOAD_QUEUED',
            undefined,
            { duration: 5000 }
        );
    });
    it('does not offer browser downloads or enqueue HLS', async () => {
        await service.start(input, async () => 'https://host/archive.m3u8');
        expect(startDownload).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(
            'EPG.PROGRAM_DIALOG.ARCHIVE_DOWNLOAD_TS_ONLY',
            undefined,
            { duration: 5000 }
        );
        isAvailable.mockReturnValue(false);
        const resolve = jest.fn();
        await service.start(input, resolve);
        expect(resolve).not.toHaveBeenCalled();
    });
    it('allows distinct programmes to resolve independently', async () => {
        let finish!: (url: string) => void;
        const first = service.start(
            input,
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                })
        );
        const another = { ...input, xtreamId: 2 };
        await service.start(another, async () => 'https://host/2.ts');
        expect(startDownload).toHaveBeenCalledWith(
            expect.objectContaining({ xtreamId: 2 })
        );
        finish('https://host/1.ts');
        await first;
        expect(startDownload).toHaveBeenCalledTimes(2);
    });

    it('coalesces pending clicks and hides provider credentials on failure', async () => {
        let reject!: (error: Error) => void;
        const first = service.start(
            input,
            () =>
                new Promise((_resolve, fail) => {
                    reject = fail;
                })
        );
        const second = jest.fn();
        await service.start(input, second);
        expect(second).not.toHaveBeenCalled();
        reject(new Error('https://secret@host'));
        await first;
        expect(open).toHaveBeenCalledWith(
            'EPG.PROGRAM_DIALOG.ARCHIVE_DOWNLOAD_FAILED',
            undefined,
            { duration: 5000 }
        );
    });
});
