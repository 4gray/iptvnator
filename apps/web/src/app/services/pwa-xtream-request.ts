import type { HttpClient } from '@angular/common/http';
import { firstValueFrom, from, fromEvent, switchMap, takeUntil } from 'rxjs';
import {
    ERROR,
    XTREAM_RESPONSE,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';
import {
    createLogger,
    createPortalDebugErrorEvent,
    createPortalDebugRequestContext,
    createPortalDebugSuccessEvent,
    logPortalDebugEvent,
    logPortalDebugRequest,
} from '@iptvnator/portal/shared/util/logger';

export interface PwaXtreamRequest {
    userAgent?: string;
    connectionTest?: boolean;
    url: string;
    params: Record<string, string>;
    macAddress?: string;
    requestId?: string;
    sessionId?: string;
    suppressErrorLog?: boolean;
}

interface PwaXtreamResponse {
    readonly payload?: unknown;
    readonly status?: number;
}

interface PwaXtreamResult {
    readonly action: string;
    readonly payload: unknown;
    readonly type: typeof XTREAM_RESPONSE;
}

interface PwaErrorResult {
    readonly message: string;
    readonly status: number;
    readonly type: typeof ERROR;
}

interface XtreamTransport {
    http: HttpClient;
    proxyUrl: string;
    getTargetId: (url: string) => Promise<string>;
    logger: ReturnType<typeof createLogger>;
    errorMessage: (error: unknown) => string;
    errorStatus: (error: unknown) => number | undefined;
    showError: (message: string) => void;
}

const silentXtreamActions = new Set<string>([
    XtreamCodeActions.GetAccountInfo,
    XtreamCodeActions.GetLiveCategories,
    XtreamCodeActions.GetVodCategories,
    XtreamCodeActions.GetSeriesCategories,
    XtreamCodeActions.GetShortEpg,
    XtreamCodeActions.GetSimpleDataTable,
    XtreamCodeActions.GetSimpleDateTable,
]);

/** Browser-only transport loads on demand, outside the Electron startup payload. */
export async function forwardPwaXtreamRequest(
    transport: XtreamTransport,
    payload: PwaXtreamRequest,
    signal?: AbortSignal
): Promise<PwaXtreamResponse | PwaXtreamResult | PwaErrorResult> {
    signal?.throwIfAborted();
    const headers = payload.macAddress
        ? { headers: { Cookie: `mac=${payload.macAddress}` } }
        : {};
    let context = createPortalDebugRequestContext({
        provider: 'xtream',
        operation: payload.params?.action ?? 'unknown',
        transport: 'pwa-http',
        request: {
            method: 'GET',
            params: payload.params,
            url: `${transport.proxyUrl}/xtream`,
        },
    });

    try {
        // Registration is shared; unsubscribing cancels this caller's wait and
        // its own GET, without aborting another reader's registration.
        const request = from(transport.getTargetId(payload.url)).pipe(
            switchMap((targetId) => {
                signal?.throwIfAborted();
                const params = {
                    targetId,
                    ...payload.params,
                    ...(payload.userAgent?.trim()
                        ? { userAgent: payload.userAgent.trim() }
                        : {}),
                    ...(payload.connectionTest
                        ? { connectionTest: 'true' }
                        : {}),
                };
                context = createPortalDebugRequestContext({
                    provider: 'xtream',
                    operation: payload.params?.action ?? 'unknown',
                    transport: 'pwa-http',
                    request: {
                        method: 'GET',
                        params,
                        url: `${transport.proxyUrl}/xtream`,
                        ...headers,
                    },
                });
                logPortalDebugRequest(context);
                return transport.http.get<PwaXtreamResponse>(
                    `${transport.proxyUrl}/xtream`,
                    {
                        params,
                        ...headers,
                        timeout: 30_000,
                    }
                );
            })
        );
        const response = await firstValueFrom(
            signal
                ? request.pipe(takeUntil(fromEvent(signal, 'abort')))
                : request
        );
        signal?.throwIfAborted();
        if (payload.connectionTest) return response;

        let result: PwaErrorResult | PwaXtreamResult;
        if (!response.payload) {
            const action = payload.params.action;
            const normalizedMessage = transport.errorMessage(response);
            logPortalDebugEvent(createPortalDebugErrorEvent(context, response));
            if (
                payload.suppressErrorLog === true ||
                silentXtreamActions.has(action)
            ) {
                transport.logger.debug(
                    `Background Xtream action failed (${action ?? 'unknown'}):`,
                    normalizedMessage
                );
                return {
                    type: ERROR,
                    status: response.status ?? 500,
                    message: normalizedMessage,
                };
            }
            result = {
                type: ERROR,
                status: response.status ?? 500,
                message: normalizedMessage,
            };
            window.postMessage(result);
        } else {
            result = {
                type: XTREAM_RESPONSE,
                payload: response.payload,
                action: payload.params.action,
            };
            logPortalDebugEvent(
                createPortalDebugSuccessEvent(context, response)
            );
            window.postMessage(result);
        }
        return result;
    } catch (error: unknown) {
        // takeUntil completes without a value; retain the caller's AbortError.
        signal?.throwIfAborted();
        logPortalDebugEvent(createPortalDebugErrorEvent(context, error));
        const action = payload.params.action;
        const normalizedMessage = transport.errorMessage(error);
        const result: PwaErrorResult = {
            type: ERROR,
            status: transport.errorStatus(error) ?? 500,
            message: normalizedMessage,
        };
        if (
            payload.suppressErrorLog === true ||
            silentXtreamActions.has(action)
        ) {
            transport.logger.debug(
                `Background Xtream action failed (${action ?? 'unknown'}):`,
                normalizedMessage
            );
            return result;
        }
        transport.logger.error('Xtream request error:', normalizedMessage);
        transport.showError(normalizedMessage);
        return result;
    }
}
