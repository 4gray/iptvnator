import { existsSync } from 'node:fs';
import { ipcMain, shell } from 'electron';
import {
    RECORDINGS_CANCEL,
    RECORDINGS_GET_LIST,
    RECORDINGS_GET_SUPPORT,
    RECORDINGS_PLAY_FILE,
    RECORDINGS_REMOVE,
    RECORDINGS_REVEAL_FILE,
    RECORDINGS_SCHEDULE,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import { recordingSchedulerService } from '../../services/recording-scheduler.service';

ipcMain.handle(RECORDINGS_GET_LIST, () => recordingSchedulerService.list());
ipcMain.handle(RECORDINGS_GET_SUPPORT, () =>
    recordingSchedulerService.getSupport()
);

ipcMain.handle(
    RECORDINGS_SCHEDULE,
    (_event, request: ScheduleRecordingRequest) =>
        recordingSchedulerService.schedule(request)
);

ipcMain.handle(RECORDINGS_CANCEL, (_event, recordingId: string) =>
    recordingSchedulerService.cancel(recordingId)
);

ipcMain.handle(RECORDINGS_REMOVE, (_event, recordingId: string) =>
    recordingSchedulerService.remove(recordingId)
);

ipcMain.handle(RECORDINGS_REVEAL_FILE, async (_event, recordingId: string) => {
    const filePath =
        await recordingSchedulerService.getAvailableFilePath(recordingId);
    if (!filePath || !existsSync(filePath)) {
        return { success: false, error: 'Recording file not found' };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
});

ipcMain.handle(RECORDINGS_PLAY_FILE, async (_event, recordingId: string) => {
    const filePath =
        await recordingSchedulerService.getAvailableFilePath(recordingId);
    if (!filePath || !existsSync(filePath)) {
        return { success: false, error: 'Recording file not found' };
    }
    const error = await shell.openPath(filePath);
    return error ? { success: false, error } : { success: true };
});
