import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { DownloadsService } from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import { VodDetailsDownloadsService } from './vod-details-downloads.service';

describe('VodDetailsDownloadsService cancel confirmation', () => {
    const openConfirmDialog = jest.fn();

    function setup(activeTitle: string | undefined) {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                VodDetailsDownloadsService,
                { provide: DialogService, useValue: { openConfirmDialog } },
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist: signal({ id: 'playlist-1' }),
                    },
                },
                {
                    provide: DownloadsService,
                    useValue: {
                        downloads: signal([]),
                        getDownloadByContent: () =>
                            activeTitle === undefined
                                ? undefined
                                : { id: 3, title: activeTitle },
                    },
                },
            ],
        });
        const service = TestBed.inject(VodDetailsDownloadsService);
        service.bind({ routeContentId: signal(42) });
        return service;
    }

    beforeEach(() => {
        openConfirmDialog.mockClear();
        TestBed.resetTestingModule();
    });

    it('names the movie being downloaded under the title', () => {
        setup('Synthetic Movie').promptCancel();

        expect(openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'DOWNLOADS.CANCEL_CONFIRM_TITLE',
                subtitle: 'Synthetic Movie',
                tone: 'destructive',
            })
        );
    });

    it('falls back to what the action does when the row has no title', () => {
        setup('').promptCancel();

        expect(openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({ subtitle: 'DIALOGS.CANCEL_DOWNLOAD' })
        );
    });
});
