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

export interface DownloadItemAction {
    readonly type: DownloadItemActionType;
    readonly item: DownloadItem;
}
