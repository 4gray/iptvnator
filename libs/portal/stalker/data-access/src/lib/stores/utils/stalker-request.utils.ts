import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
import { DataService } from '@iptvnator/services';
import {
    Playlist,
    PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';

export interface StalkerRequestDeps {
    dataService: DataService;
    stalkerSession: StalkerSessionService;
}

export class StalkerEndpointShapeRecoveryError extends Error {
    readonly code = 'stalker-endpoint-shape-recovery-failed';

    constructor() {
        super('stalker-endpoint-shape-recovery-failed');
        this.name = 'StalkerEndpointShapeRecoveryError';
    }
}

export function toStalkerSessionPlaylist(playlist: PlaylistMeta): Playlist {
    return {
        lastUsage: '',
        ...playlist,
    } as Playlist;
}

export async function executeStalkerRequest<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>
): Promise<T> {
    return executeStalkerRequestAttempt(deps, playlist, params, true, false);
}

async function executeStalkerRequestAttempt<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>,
    allowEndpointRecovery: boolean,
    requireCompatibleEndpointEnvelope: boolean
): Promise<T> {
    if (usesTypedStalkerSession(deps, playlist)) {
        return deps.stalkerSession.makeAuthenticatedRequest<T>(
            toStalkerSessionPlaylist(playlist),
            params
        );
    }

    const canRecoverEndpoint =
        allowEndpointRecovery &&
        shouldRecoverEndpointShape(deps, playlist);
    if (!canRecoverEndpoint && !requireCompatibleEndpointEnvelope) {
        return deps.dataService.sendIpcEvent<T>(STALKER_REQUEST, {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params,
        });
    }

    let response: T;
    try {
        response = await deps.dataService.sendIpcEvent<T>(STALKER_REQUEST, {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params,
        });
    } catch (error) {
        if (canRecoverEndpoint && hasUnsupportedEndpointStatus(error)) {
            const recovered = await recoverEndpointShape(deps, playlist);
            if (recovered !== undefined) {
                return executeStalkerRequestAttempt(
                    deps,
                    recovered,
                    params,
                    false,
                    true
                );
            }
        }
        throw error;
    }

    if (hasIncompatibleEndpointEnvelope(response)) {
        if (canRecoverEndpoint) {
            const recovered = await recoverEndpointShape(deps, playlist);
            if (recovered !== undefined) {
                return executeStalkerRequestAttempt(
                    deps,
                    recovered,
                    params,
                    false,
                    true
                );
            }
        }
        throw new StalkerEndpointShapeRecoveryError();
    }
    return response;
}

export function usesTypedStalkerSession(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta
): boolean {
    return Boolean(
        playlist.stalkerRequestRecipe === 'full-session' &&
            supportsTypedSessions(deps.stalkerSession)
    );
}

function supportsTypedSessions(stalkerSession: StalkerSessionService): boolean {
    const probe = (
        stalkerSession as Partial<
            Pick<StalkerSessionService, 'supportsTypedSessions'>
        >
    ).supportsTypedSessions;
    return typeof probe !== 'function' || probe.call(stalkerSession);
}

function shouldRecoverEndpointShape(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta
): boolean {
    return (
        playlist.stalkerRequestRecipe === 'stateless-mac' &&
        playlist.stalkerRecipeClassifierVersion ===
            STALKER_RECIPE_CLASSIFIER_VERSION &&
        supportsTypedSessions(deps.stalkerSession)
    );
}

async function recoverEndpointShape(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta
): Promise<Playlist | undefined> {
    try {
        return await deps.stalkerSession.recoverEndpointShape(
            toStalkerSessionPlaylist(playlist)
        );
    } catch {
        return undefined;
    }
}

function hasUnsupportedEndpointStatus(error: unknown): boolean {
    const status = readStatus(error);
    return status === 404 || status === 405 || status === 501;
}

function readStatus(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Readonly<Record<string, unknown>>;
    if (typeof record['status'] === 'number') {
        return record['status'];
    }
    const response = record['response'];
    if (typeof response !== 'object' || response === null) {
        return undefined;
    }
    const responseStatus = (response as Readonly<Record<string, unknown>>)[
        'status'
    ];
    return typeof responseStatus === 'number' ? responseStatus : undefined;
}

function hasIncompatibleEndpointEnvelope(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return true;
    }
    return !Object.prototype.hasOwnProperty.call(value, 'js');
}
