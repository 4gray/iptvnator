import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NotificationService } from '@iptvnator/services/notifications';
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

describe('RecordingManagerActionsService failure messages', () => {
    const recordings = {
        stopRecording: jest.fn(),
        playFile: jest.fn(),
        revealFile: jest.fn(),
        loadRecordings: jest.fn().mockResolvedValue(undefined),
    };
    const error = jest.fn();
    const item = {
        id: 3,
        status: 'completed',
        filePath: '/recordings/synthetic.ts',
        channelName: 'Channel One',
        startedAt: '2026-11-18T10:00:00.000Z',
    } as RecordingItem;

    function setup(): RecordingManagerActionsService {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                RecordingManagerActionsService,
                { provide: RecordingsService, useValue: recordings },
                { provide: DialogService, useValue: {} },
                { provide: NotificationService, useValue: { error } },
            ],
        });
        return TestBed.inject(RecordingManagerActionsService);
    }

    beforeEach(() => {
        error.mockClear();
        recordings.loadRecordings.mockClear();
    });

    it('reports a failed stop by key only, without the system text', async () => {
        recordings.stopRecording.mockRejectedValue(
            new Error('EPERM /recordings/synthetic.ts')
        );

        await expect(setup().run({ item, type: 'stop' })).resolves.toBe(
            'failed'
        );
        expect(error).toHaveBeenCalledWith('DOWNLOADS.ACTION_FAILED');
    });

    it('says a recording without a file is missing', async () => {
        await expect(
            setup().run({
                item: { ...item, filePath: '' },
                type: 'play',
            })
        ).resolves.toBe('file-missing');
        expect(error).toHaveBeenCalledWith('DOWNLOADS.FILE_NOT_FOUND');
    });

    it('reloads the list when the file vanished and says so', async () => {
        recordings.playFile.mockResolvedValue({
            success: false,
            error: 'File not found',
        });

        await expect(setup().run({ item, type: 'play' })).resolves.toBe(
            'file-missing'
        );
        expect(recordings.loadRecordings).toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith('DOWNLOADS.FILE_NOT_FOUND');
    });

    it('reports another file action failure generically', async () => {
        recordings.revealFile.mockResolvedValue({
            success: false,
            error: 'spawn failed',
        });

        await expect(setup().run({ item, type: 'reveal' })).resolves.toBe(
            'failed'
        );
        expect(error).toHaveBeenCalledWith('DOWNLOADS.FILE_ACTION_ERROR');
    });

    it('falls back to the generic message when handling a failure throws', async () => {
        recordings.playFile.mockResolvedValue({
            success: false,
            error: 'File not found',
        });
        recordings.loadRecordings.mockRejectedValueOnce(new Error('offline'));

        await expect(setup().run({ item, type: 'play' })).resolves.toBe(
            'file-missing'
        );
        expect(error).toHaveBeenCalledWith('DOWNLOADS.ACTION_FAILED');
    });
});
