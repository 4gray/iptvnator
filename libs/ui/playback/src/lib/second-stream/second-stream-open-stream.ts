import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

export type SecondStreamView = 'primary' | 'secondary';

export interface SecondStreamOpenStream {
    readonly view: SecondStreamView;
    readonly playback: ResolvedPortalPlayback;
    readonly small: boolean;
    readonly muted: boolean;
}

export interface SecondStreamPickerData {
    readonly returningToOriginal: boolean;
    readonly initialPlaylist?: string;
}
