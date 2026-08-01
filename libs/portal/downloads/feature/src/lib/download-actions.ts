import type { DownloadItem } from '@iptvnator/services';

export type DownloadItemActionType =
    | 'cancel'
    | 'copy-url'
    | 'pause'
    | 'play'
    | 'remove'
    | 'redownload'
    | 'resume'
    | 'retry'
    | 'reveal';

export type DownloadActionResult =
    'success' | 'file-missing' | 'failed' | 'ignored';

export interface DownloadItemAction {
    readonly type: DownloadItemActionType;
    readonly item: DownloadItem;
}
