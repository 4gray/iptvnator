import { CollectionScope } from '@iptvnator/portal/shared/util';

/** The guides this runtime offers; see `RuntimeCapabilitiesService`. */
export interface CollectionGuideSupport {
    /** XMLTV guides for M3U channels (`supportsEpg`). */
    readonly xmltv: boolean;
    /** Xtream and Stalker provider guides (`supportsProviderEpg`). */
    readonly provider: boolean;
}

/**
 * Whether the collection's loading skeleton reserves the programme line.
 * Same rule as the rows (`GlobalFavoritesListComponent.guideBySource`): M3U
 * rows need XMLTV, Xtream and Stalker rows their provider's guide. A
 * collection scoped to one playlist knows its source; one across all
 * playlists may hold any, so it reserves the line whenever a guide exists.
 */
export function collectionSkeletonShowsEpg(
    portalType: string | undefined,
    scope: CollectionScope,
    guides: CollectionGuideSupport
): boolean {
    if (scope === 'playlist' && portalType === 'm3u') {
        return guides.xmltv;
    }
    if (
        scope === 'playlist' &&
        (portalType === 'xtream' || portalType === 'stalker')
    ) {
        return guides.provider;
    }
    return guides.xmltv || guides.provider;
}
