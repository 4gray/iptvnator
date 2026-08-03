/**
 * Host-owned canonical logical content identity. Source and content IDs must
 * not come from the currently selected provider copy or playback URL.
 */
export type PlaybackSessionIdentity =
    | {
          readonly kind: 'live';
          readonly sourceId: string;
          readonly contentId: string | number;
      }
    | {
          readonly kind: 'vod';
          readonly sourceId: string;
          readonly contentId: string | number;
      }
    | {
          readonly kind: 'episode';
          readonly sourceId: string;
          readonly contentId: string | number;
          readonly seriesId?: string | number;
          readonly seasonNumber?: number;
          readonly episodeNumber?: number;
      };

export function createPlaybackSessionKey(
    identity: PlaybackSessionIdentity
): string {
    const parts = [
        identity.kind,
        identity.sourceId,
        String(identity.contentId),
        identity.kind === 'episode' ? String(identity.seriesId ?? '') : '',
        identity.kind === 'episode' ? String(identity.seasonNumber ?? '') : '',
        identity.kind === 'episode' ? String(identity.episodeNumber ?? '') : '',
    ];

    return parts.map((part) => `${part.length}:${part}`).join('|');
}
