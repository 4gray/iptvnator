import {
    isFullStalkerPortalPlaylist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { stalkerIdentityFingerprint } from './stalker-identity.utils';

/** What a probe of one source configuration concluded this session. */
export type StalkerProbeRecord =
    StalkerPortalModeOverride | 'no-change' | 'discarded';

export interface StalkerPortalModeOverride {
    sourcePortalUrl?: string;
    sourceIsFullStalkerPortal: boolean;
    identityFingerprint: string;
    credentialsFingerprint: string;
    portalUrl: string;
    isFullStalkerPortal: boolean;
}

export function stalkerCredentialsFingerprint(playlist: PlaylistMeta): string {
    return JSON.stringify([playlist.username ?? '', playlist.password ?? '']);
}

export function stalkerRepairSourceFingerprint(playlist: PlaylistMeta): string {
    return JSON.stringify([
        playlist.portalUrl ?? '',
        isFullStalkerPortalPlaylist(playlist),
        stalkerIdentityFingerprint(playlist),
        playlist.username ?? '',
        playlist.password ?? '',
    ]);
}
