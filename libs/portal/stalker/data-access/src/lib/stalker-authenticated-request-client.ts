import {
    extractStalkerAuthFailureBody,
    isFullStalkerPortalPlaylist,
    type Playlist,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import type { DataService } from '@iptvnator/services';
import { StalkerPortalError } from './stalker-portal-error';
import { isStalkerAuthorizationFailure } from './stalker-response-classification';
import { stalkerSessionFingerprint } from './stalker-session-store';
import type { StalkerTokenCache } from './stalker-token-cache';

/** Authenticated request + one-shot session renewal shared by all callers. */
export class StalkerAuthenticatedRequestClient {
    constructor(
        private readonly dataService: DataService,
        private readonly tokens: StalkerTokenCache,
        private readonly ensureToken: (
            playlist: Playlist
        ) => Promise<{ token: string | null; serialNumber?: string }>,
        private readonly assertCurrent: (
            playlist: Playlist,
            sessionFingerprint: string
        ) => void
    ) {}

    async request<T>(
        playlist: Playlist,
        params: Record<string, string | number>,
        retryOnAuthFailure = true
    ): Promise<T> {
        // Bind the whole request to one immutable connection snapshot. An
        // Edit can replace the authoritative endpoint/mode while transport is
        // in flight; its old response must never reach a store or player.
        const configuration = { ...playlist } as Playlist;
        const sessionFingerprint =
            stalkerSessionFingerprint(configuration);
        const { token, serialNumber } =
            await this.ensureToken(configuration);

        try {
            const response = await this.dataService.sendIpcEvent<T>(
                STALKER_REQUEST,
                {
                    url: configuration.portalUrl,
                    macAddress: configuration.macAddress,
                    params,
                    token,
                    ...(serialNumber ? { serialNumber } : {}),
                }
            );
            this.assertCurrent(configuration, sessionFingerprint);
            if (isStalkerAuthorizationFailure(response)) {
                return this.handleAuthorizationFailure<T>(
                    configuration,
                    params,
                    token,
                    response,
                    retryOnAuthFailure
                );
            }
            return response;
        } catch (error) {
            // A classified response above is already wrapped with its
            // redacted portal body. Re-classifying that app-owned error would
            // discard the body and replace it with an empty failure.
            if (error instanceof StalkerPortalError) {
                throw error;
            }
            if (isStalkerAuthorizationFailure(error)) {
                this.tokens.retireFailed(configuration._id, token);
                if (
                    retryOnAuthFailure &&
                    isFullStalkerPortalPlaylist(configuration)
                ) {
                    return this.request<T>(configuration, params, false);
                }
            }
            // Transport evidence (especially HTTP 401/403) is consumed by
            // lazy repair. Preserve it exactly after retry exhaustion.
            throw error;
        }
    }

    private handleAuthorizationFailure<T>(
        playlist: Playlist,
        params: Record<string, string | number>,
        failedToken: string | null,
        failure: unknown,
        retryOnAuthFailure: boolean
    ): Promise<T> {
        this.tokens.retireFailed(playlist._id, failedToken);
        if (retryOnAuthFailure && isFullStalkerPortalPlaylist(playlist)) {
            return this.request<T>(playlist, params, false);
        }

        const failureBody = extractStalkerAuthFailureBody(failure) ?? undefined;
        throw new StalkerPortalError('auth-failed', failureBody, failureBody);
    }
}
