import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

export interface SecondStreamOpenStream {
    readonly playback: ResolvedPortalPlayback;
    readonly small: boolean;
    readonly muted: boolean;
}

export interface SecondStreamPickerData {
    readonly returningToOriginal: boolean;
    readonly initialPlaylist?: string;
}
