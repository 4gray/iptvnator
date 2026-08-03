import type {
    ExternalPlayerName,
} from '@iptvnator/shared/interfaces';
import type {
    InlinePlaybackPlayer,
    PlaybackDiagnostic,
} from './diagnostics/playback-diagnostics.model';

export const PlaybackRecommendationReason = {
    RetryTransientFailure: 'retry-transient-failure',
    RetryUnknownFailure: 'retry-unknown-failure',
    AlternativeSourceAvailable: 'alternative-source-available',
    DifferentEngineFamily: 'different-engine-family',
    ExternalCodecOrContainerSupport: 'external-codec-or-container-support',
    ExternalBrowserAccess: 'external-browser-access',
    CompatibleDrmPath: 'compatible-drm-path',
} as const;

export type PlaybackRecommendationReason =
    (typeof PlaybackRecommendationReason)[keyof typeof PlaybackRecommendationReason];

export type PlaybackRecommendationPriority = 'primary' | 'secondary';

export type PlaybackRecommendationTarget =
    | InlinePlaybackPlayer
    | ExternalPlayerName;

export const PlaybackSourceKind = {
    Hls: 'hls',
    MpegTs: 'mpegts',
    Dash: 'dash',
    Native: 'native',
    Unknown: 'unknown',
} as const;

export type PlaybackSourceKind =
    (typeof PlaybackSourceKind)[keyof typeof PlaybackSourceKind];

export const PlaybackEngineFamily = {
    Vhs: 'vhs',
    HlsJs: 'hls.js',
    MpegTsJs: 'mpegts.js',
    Shaka: 'shaka',
    NativeMedia: 'native-media',
} as const;

export type PlaybackEngineFamily =
    (typeof PlaybackEngineFamily)[keyof typeof PlaybackEngineFamily];

export type PlaybackTargetCapability =
    | {
          readonly kind: 'inline';
          readonly target: InlinePlaybackPlayer;
          readonly available: boolean;
          readonly engineFamily: PlaybackEngineFamily | null;
      }
    | {
          readonly kind: 'external';
          readonly target: ExternalPlayerName;
          readonly available: boolean;
      };

export interface PlaybackRecommendationSourceContext {
    readonly kind: PlaybackSourceKind;
    readonly isLive: boolean;
    readonly drm: 'none' | 'untransferable';
    readonly externalTransferable: boolean;
}

export interface PlaybackRecommendationContext {
    readonly diagnostic: PlaybackDiagnostic;
    readonly activeTarget: PlaybackRecommendationTarget;
    readonly attemptedTargets: ReadonlySet<PlaybackRecommendationTarget>;
    readonly targetCapabilities: readonly PlaybackTargetCapability[];
    readonly source: PlaybackRecommendationSourceContext;
    readonly alternativeSourceCount: number;
}

export type PlaybackRecommendation =
    | {
          readonly action: 'retry';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      }
    | {
          readonly action: 'alternative-source';
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      }
    | {
          readonly action: 'player';
          readonly target: PlaybackRecommendationTarget;
          readonly reason: PlaybackRecommendationReason;
          readonly priority: PlaybackRecommendationPriority;
      };
