import { Injectable, Injector, inject } from '@angular/core';
import {
    DataService,
    PortalStatusService,
    SettingsStore,
    withSourceProbe,
} from '@iptvnator/services';
import { StalkerSourceHealthService } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistMeta,
    SourceProbeContext,
    SourceHealthResult,
    sourceHealthUnknown,
    sourceHealthType,
    accountHealth,
    resolveXtreamPortalExpiration,
    XtreamPortalStatusResponseLike,
} from '@iptvnator/shared/interfaces';

@Injectable({ providedIn: 'root' })
export class SourceHealthProbesService {
    private readonly injector = inject(Injector);
    private readonly data = inject(DataService);
    async check(
        p: PlaylistMeta,
        probe: SourceProbeContext,
        signal?: AbortSignal
    ): Promise<SourceHealthResult> {
        switch (sourceHealthType(p)) {
            case 'stalker':
                return this.injector
                    .get(StalkerSourceHealthService)
                    .check(p, probe, signal);
            case 'm3u':
                return window.electron.probeM3uSource({
                    url: p.url!,
                    userAgent: p.userAgent,
                    trustedInsecureTlsHosts:
                        this.injector
                            .get(SettingsStore)
                            .trustedInsecureTlsHosts?.() ?? [],
                    probe,
                });
            case 'xtream': {
                const data = withSourceProbe(this.data, probe, signal);
                let failure: unknown;
                for (const action of [
                    'get_account_info',
                    null,
                    'get_profile',
                ]) {
                    try {
                        const response = await data.sendIpcEvent<{
                            payload?: XtreamPortalStatusResponseLike;
                        }>('XTREAM_REQUEST', {
                            url: p.serverUrl,
                            params: {
                                username: p.username,
                                password: p.password,
                                ...(action ? { action } : {}),
                            },
                            suppressErrorLog: true,
                        });
                        if (!response?.payload?.user_info) continue;
                        this.injector
                            .get(PortalStatusService)
                            .rememberXtreamResponse(
                                p.serverUrl!,
                                p.username!,
                                p.password!,
                                response.payload
                            );
                        const info = response.payload.user_info;
                        if (
                            info.auth === false ||
                            info.auth === 0 ||
                            info.auth === '0'
                        ) {
                            const explicit = accountHealth(info.status);
                            return explicit.confirmedInactive
                                ? explicit
                                : {
                                      ...sourceHealthUnknown('auth'),
                                      state: 'inactive',
                                  };
                        }
                        return accountHealth(
                            info.status,
                            resolveXtreamPortalExpiration(response.payload) ??
                                undefined,
                            info.auth === true ||
                                info.auth === 1 ||
                                info.auth === '1'
                        );
                    } catch (error) {
                        failure = error;
                    }
                }
                if (failure) throw failure;
                return sourceHealthUnknown('invalid');
            }
            default:
                return sourceHealthUnknown();
        }
    }
}
