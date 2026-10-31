/** Versioned opt-in protocol for the household activity of a verified source server. */
export interface ActivityAddress {
    instanceId: string;
    scope: 'shared';
    sourceId: string;
    sourceIncarnation: string;
    content: ActivityContentIdentity;
}

export type ActivityContentIdentity =
    | { provider: 'xtream' | 'stalker'; kind: 'vod'; id: string }
    | {
          provider: 'xtream';
          kind: 'episode';
          seriesId: string;
          id: string;
      }
    | {
          provider: 'stalker';
          kind: 'episode';
          mode: 'regular' | 'embedded' | 'lazy';
          seriesId: string;
          id: string;
          seasonKey: string;
          episodeNumber: number;
      };

export interface ActivityResume {
    positionSeconds: number;
    durationSeconds?: number;
}

export interface ActivitySession {
    deviceId: string;
    sessionId: string;
    sequence: number;
}

/** Empty values remain stored: revision/generation are reset barriers, not cache data. */
export interface ActivityState {
    updatedAt?: string;
    /** Display/legacy lookup hints only; never part of canonical identity. */
    positionMetadata?: ActivityPositionMetadata;
    revision: number;
    generation: number;
    owner: ActivitySession | null;
    resume: ActivityResume | null;
    watched: boolean;
    watchedOrigin: 'manual' | 'automatic' | 'legacy-unknown' | null;
}

interface ActivityOperationBase {
    positionMetadata?: ActivityPositionMetadata;
    operationId: string;
    deviceId: string;
}

export type ActivityOperation = ActivityOperationBase &
    (
        | {
              kind: 'begin';
              expectedRevision: number;
              sessionId: string;
          }
        | {
              kind: 'checkpoint';
              generation: number;
              sessionId: string;
              sequence: number;
              resume: ActivityResume;
          }
        | {
              kind: 'mark-watched' | 'reset';
              expectedRevision: number;
          }
        | {
              kind: 'import';
              expectedRevision: number;
              resume: ActivityResume | null;
              watched: boolean;
          }
    );

export type ActivityApplyResult =
    | { status: 'applied'; state: ActivityState }
    | {
          status: 'conflict';
          reason: 'revision' | 'session' | 'sequence';
          state: ActivityState;
      };

/** Frozen at enqueue: replay never silently moves an intent to new consent/profile. */
export interface ActivityPendingOperation {
    address: ActivityAddress;
    consentGeneration: string;
    operation: ActivityOperation;
}

/** The local projection and pending operations must be committed together. */
export interface ActivityLocalRecord {
    state: ActivityState;
    pending: ActivityPendingOperation[];
    position?: import('../playback-position.interface').PlaybackPositionData;
    conflict?: ActivityState;
}

export interface ActivityPositionMetadata {
    title?: string;
    contentXtreamId: number;
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
}
