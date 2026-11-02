import { InjectionToken } from '@angular/core';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';

export interface PlaybackActivityEvents {
    active(): boolean;
    checkpoint(position: PlaybackPositionData): Promise<void>;
    begin(
        info: PlayerContentInfo,
        startTime?: number,
        title?: string
    ): Promise<void>;
    register(
        sourceId: string,
        positions: PlaybackPositionData[]
    ): Promise<void>;
}
export const PLAYBACK_ACTIVITY_EVENTS =
    new InjectionToken<PlaybackActivityEvents>('PLAYBACK_ACTIVITY_EVENTS', {
        providedIn: 'root',
        factory: () => ({
            active: () => false,
            checkpoint: async () => undefined,
            begin: async () => undefined,
            register: async () => undefined,
        }),
    });
