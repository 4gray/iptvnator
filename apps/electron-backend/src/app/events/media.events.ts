import { ipcMain } from 'electron';
import {
    mediaMetadataBackgroundWarmup,
    type MediaMetadataBackgroundStartPayload,
} from '../services/media-metadata-background-warmup.service';
import { probeMediaStreamMetadata } from '../services/media-stream-metadata.service';

interface MediaStreamMetadataProbeRequest {
    url: string;
    headers?: Record<string, string>;
}

export default class MediaEvents {
    static bootstrapMediaEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(
    'MEDIA_PROBE_STREAM_METADATA',
    async (_event, payload: MediaStreamMetadataProbeRequest) =>
        probeMediaStreamMetadata(payload)
);

ipcMain.handle(
    'MEDIA_METADATA_BACKGROUND_START',
    async (_event, payload: MediaMetadataBackgroundStartPayload) =>
        mediaMetadataBackgroundWarmup.start(payload)
);

ipcMain.handle('MEDIA_METADATA_BACKGROUND_STATUS', async () =>
    mediaMetadataBackgroundWarmup.getStatus()
);

ipcMain.handle('MEDIA_METADATA_BACKGROUND_CANCEL', async () =>
    mediaMetadataBackgroundWarmup.cancel()
);
