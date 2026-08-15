import type { ElectronRecordingItem } from '@iptvnator/shared/interfaces';

/**
 * Renderer-facing live-TV recording row. The bridge type is already
 * camelCased and carries the decoded `programs` array plus the derived
 * `fileAvailability`, so the renderer model is a direct alias.
 */
export type RecordingItem = ElectronRecordingItem;

export type {
    RecordingProgramSnapshot,
    RecordingSourceType,
    RecordingStatus,
} from '@iptvnator/shared/interfaces';
