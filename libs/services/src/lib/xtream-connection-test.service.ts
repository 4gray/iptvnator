import { Injectable, inject } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    resolveXtreamPortalStatus,
    XtreamConnectionFailure,
    XtreamPortalStatusResponseLike,
    XtreamPortalStatusType,
    xtreamHttpAlternative,
} from '@iptvnator/shared/interfaces';
import { DataService } from './data.service';
import { resetHostConnectivityGuard } from './host-connectivity-reset';
import { PortalStatusService } from './portal-status.service';

export interface XtreamTestConnection {
    serverUrl: string;
    username: string;
    password: string;
}

export interface XtreamConnectionTestResult {
    status: XtreamPortalStatusType;
    serverUrl: string;
    usedHttpFallback: boolean;
    failure?: XtreamConnectionFailure;
}

@Injectable({ providedIn: 'root' })
export class XtreamConnectionTestService {
    private readonly data = inject(DataService);
    private readonly portalStatus = inject(PortalStatusService);

    /** Explicit form action only. Passive status checks never discover protocols. */
    async test(
        connection: XtreamTestConnection,
        isCurrent: () => boolean = () => true,
        allowHttpFallback = false
    ): Promise<XtreamConnectionTestResult> {
        const normalized = {
            serverUrl: normalizeXtreamServerUrl(connection.serverUrl),
            username: connection.username.trim(),
            password: connection.password.trim(),
        };
        const first = await this.probe(normalized, isCurrent);
        const alternative = xtreamHttpAlternative(normalized.serverUrl);
        if (
            !allowHttpFallback ||
            !alternative ||
            !first.failure?.canTryHttp ||
            !isCurrent()
        ) {
            return first;
        }
        const second = await this.probe(
            { ...normalized, serverUrl: alternative },
            isCurrent
        );
        // Never replace a user's address with a failed or unauthenticated one.
        return second.status === 'active'
            ? { ...second, usedHttpFallback: true }
            : { ...second, serverUrl: normalized.serverUrl };
    }

    private async probe(
        connection: XtreamTestConnection,
        isCurrent: () => boolean
    ): Promise<XtreamConnectionTestResult> {
        const result: XtreamConnectionTestResult = {
            status: 'unavailable',
            serverUrl: connection.serverUrl,
            usedHttpFallback: false,
        };
        await resetHostConnectivityGuard(this.data, connection.serverUrl);
        let responseObserved = false;
        for (const action of ['get_account_info', null, 'get_profile']) {
            if (!isCurrent()) return result;
            try {
                const response = await this.data.sendIpcEvent<{
                    payload?: XtreamPortalStatusResponseLike;
                    connectionFailure?: XtreamConnectionFailure;
                }>('XTREAM_REQUEST', {
                    url: connection.serverUrl,
                    params: {
                        username: connection.username,
                        password: connection.password,
                        ...(action ? { action } : {}),
                    },
                    connectionTest: true,
                    suppressErrorLog: true,
                });
                if (response?.connectionFailure) {
                    result.failure = {
                        ...response.connectionFailure,
                        canTryHttp:
                            !responseObserved &&
                            response.connectionFailure.canTryHttp,
                    };
                    if (
                        response.connectionFailure.kind === 'http' &&
                        [400, 404, 405].includes(
                            response.connectionFailure.status ?? 0
                        )
                    ) {
                        responseObserved = true;
                        continue;
                    }
                    return result;
                }
                responseObserved = true;
                const status = resolveXtreamPortalStatus(response?.payload);
                if (status !== 'unavailable') {
                    if (isCurrent())
                        this.portalStatus.rememberXtreamResponse(
                            connection.serverUrl,
                            connection.username,
                            connection.password,
                            response?.payload
                        );
                    return { ...result, status, failure: undefined };
                }
            } catch {
                // Old backends and unknown transport failures cannot authorize
                // sending credentials over HTTP. No parsing of error strings.
                return result;
            }
        }
        return result;
    }
}
