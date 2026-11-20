import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { type RecordingItem, RecordingsService } from '@iptvnator/services';
import { DialogService } from '@iptvnator/ui/components';
import { RecordingManagerActionsService } from './recording-manager-actions.service';

describe('RecordingManagerActionsService remove confirmation', () => {
    const openConfirmDialog = jest.fn();

    function setup(): RecordingManagerActionsService {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                RecordingManagerActionsService,
                { provide: RecordingsService, useValue: {} },
                { provide: DialogService, useValue: { openConfirmDialog } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        });
        return TestBed.inject(RecordingManagerActionsService);
    }

    beforeEach(() => openConfirmDialog.mockClear());

    it.each([
        [
            'the recorded programme',
            'Synthetic Evening News',
            'Synthetic Evening News',
        ],
        ['the channel when no programme is known', undefined, 'Channel One'],
    ])('names %s under the title', async (_case, programTitle, subtitle) => {
        const item = {
            id: 7,
            status: 'completed',
            filePath: '/recordings/synthetic.ts',
            channelName: 'Channel One',
            programTitle,
            startedAt: '2026-11-18T10:00:00.000Z',
        } as RecordingItem;

        await setup().run({ item, type: 'remove' });

        expect(openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'DOWNLOADS.REMOVE_RECORDING_DIALOG.TITLE',
                subtitle,
                tone: 'destructive',
            })
        );
    });
});
