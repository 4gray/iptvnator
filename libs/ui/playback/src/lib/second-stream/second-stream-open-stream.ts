import type { SecondStreamIdentity } from './second-stream-identity';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

export type MultiviewSlot = 1 | 2 | 3 | 4;
export type CompanionSlot = Exclude<MultiviewSlot, 1>;
export type MultiviewLayout =
    'single' | 'pip' | 'side-by-side' | 'grid' | 'focus';

export interface SecondStreamOpenStream {
    readonly slot: MultiviewSlot;
    readonly playback: ResolvedPortalPlayback;
    readonly small: boolean;
    readonly muted: boolean;
}

export interface SecondStreamPickerData {
    readonly slot: CompanionSlot;
    readonly replace: boolean;
    readonly returningToOriginal: boolean;
    readonly initialPlaylist?: string;
    readonly findDuplicateSlot: (
        identity: SecondStreamIdentity
    ) => MultiviewSlot | undefined;
}
