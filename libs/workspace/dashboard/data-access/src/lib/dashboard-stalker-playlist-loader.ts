import type { Injector } from '@angular/core';
import { PlaylistsService } from '@iptvnator/services';
import type { Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';

export class DashboardIncompleteCatalogError extends Error {}

const connectionFields = [
    'macAddress',
    'username',
    'password',
    'userAgent',
    'origin',
    'referrer',
] as const;
const optionalStalkerFields = [
    'isFullStalkerPortal',
    'stalkerSerialNumber',
    'stalkerDeviceId1',
    'stalkerDeviceId2',
    'stalkerSignature1',
    'stalkerSignature2',
    'updateDate',
] as const;

/** Electron's inventory omits full portal authentication details. */
export function createDashboardStalkerPlaylistLoader(injector: Injector) {
    const sources = new Map<string, Promise<Playlist>>();
    return async (meta: PlaylistMeta): Promise<Playlist> => {
        let pending = sources.get(meta._id);
        if (!pending) {
            pending = firstValueFrom(
                injector.get(PlaylistsService).getPlaylistById(meta._id)
            );
            sources.set(meta._id, pending);
        }
        const playlist = await pending;
        const portalUrl = playlist?.portalUrl ?? playlist?.url;
        if (
            playlist?._id !== meta._id ||
            !portalUrl ||
            portalUrl !== meta.portalUrl ||
            connectionFields.some(
                (field) => (meta[field] ?? '') !== (playlist[field] ?? '')
            ) ||
            optionalStalkerFields.some(
                (field) =>
                    meta[field] !== undefined && meta[field] !== playlist[field]
            )
        ) {
            throw new DashboardIncompleteCatalogError(
                'Stalker source settings changed while loading episodes'
            );
        }
        return { ...playlist, portalUrl };
    };
}
