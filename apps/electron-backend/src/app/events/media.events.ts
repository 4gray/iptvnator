import { ipcMain } from 'electron';
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
