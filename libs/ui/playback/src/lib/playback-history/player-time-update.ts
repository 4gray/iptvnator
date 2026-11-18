import type { PlaybackPositionUpdate } from '@iptvnator/shared/interfaces';

/**
 * Position report an engine emits on every media time update; `playing`
 * tells pause and seek reports apart from playing ones.
 */
export type PlayerTimeUpdate = PlaybackPositionUpdate;
