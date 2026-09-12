import { Injectable, inject } from '@angular/core';
import { DataService, withSourceProbe } from '@iptvnator/services';
import {
    accountHealth,
    isFullStalkerPortalPlaylist,
    PlaylistMeta,
    SourceHealthResult,
    SourceProbeContext,
    sourceHealthUnknown,
    isStalkerAuthFailureResponse,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    StalkerSessionService,
    getStalkerPortalIdentityFromPlaylist,
} from './stalker-session.service';
import { StalkerAuthApi } from './stalker-auth.api';
import { parseStalkerDate } from './stalker-account-info.service';
import {
    executeStalkerRequest,
    toStalkerSessionPlaylist,
} from './stores/utils/stalker-request.utils';

@Injectable({ providedIn: 'root' })
export class StalkerSourceHealthService {
    private readonly data = inject(DataService);
    private readonly session = inject(StalkerSessionService);

    async check(
        playlist: PlaylistMeta,
        probe: SourceProbeContext,
        signal?: AbortSignal
    ): Promise<SourceHealthResult> {
        const dataService = withSourceProbe(this.data, probe, signal);
        let response: { js?: Record<string, unknown> };
        if (isFullStalkerPortalPlaylist(playlist)) {
            // Authentication is shared with playback. UI cancellation must not
            // abort or shorten its slot. Only this health consumer stops waiting.
            const session = await waitForSession(
                this.session.ensureToken(toStalkerSessionPlaylist(playlist)),
                probe.deadlineAt
            );
            if (Date.now() >= probe.deadlineAt)
                return sourceHealthUnknown('timeout');
            response = await new StalkerAuthApi(
                dataService,
                createLogger('SourceHealth')
            ).getProfile(
                playlist.portalUrl!,
                playlist.macAddress!,
                session.token!,
                getStalkerPortalIdentityFromPlaylist(playlist),
                ''
            );
            // Bare profile status is a protocol challenge, not account status.
            if (!response.js?.['id'] && !response.js?.['account_info'])
                return sourceHealthUnknown('auth');
        } else {
            response = await executeStalkerRequest(
                { dataService, stalkerSession: this.session },
                playlist,
                {
                    type: 'account_info',
                    action: 'get_main_info',
                    JsHttpRequest: '1-xml',
                }
            );
        }
        if (isStalkerAuthFailureResponse(response))
            return { ...sourceHealthUnknown('auth'), state: 'inactive' };
        if (!response?.js || typeof response.js !== 'object')
            return sourceHealthUnknown('invalid');
        const nested = response.js['account_info'];
        const info =
            nested && typeof nested === 'object'
                ? (nested as Record<string, unknown>)
                : isFullStalkerPortalPlaylist(playlist)
                  ? {}
                  : response.js;
        const expiry = parseStalkerDate(
            (info['expire_date'] ??
                info['end_date'] ??
                info['expire_billing_date']) as string | number | undefined
        );
        const status = info['status'];
        return accountHealth(
            status === 0 || status === '0'
                ? 'disabled'
                : status === 1 || status === '1'
                  ? 'active'
                  : status,
            expiry,
            Object.keys(info).length > 0 || Boolean(response.js['id'])
        );
    }
}

async function waitForSession<T>(
    request: Promise<T>,
    deadlineAt: number
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            request,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Source probe timeout')),
                    Math.max(0, deadlineAt - Date.now())
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
