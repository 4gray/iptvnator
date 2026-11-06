import type { HttpClient } from '@angular/common/http';
import type { TranslateService } from '@ngx-translate/core';
import type { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import type { ProviderTargetClient } from './provider-target-client';
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
    providerTargets: ProviderTargetClient;
    logger: ReturnType<typeof createLogger>;
    translate: Pick<TranslateService, 'instant'>;
    snackBar: Pick<LazySnackBar, 'open'>;
    errorStatus: (error: unknown) => number | undefined;
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
        const request = transport.providerTargets.request(
            payload.url,
            (targetId) => {
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
                    }
                );
            }
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
            const normalizedMessage = getReadableXtreamErrorMessage(
                response,
                transport.translate.instant(
                    'PORTALS.REQUEST_ERRORS.XTREAM_CONNECTION'
                )
            );
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
        const normalizedMessage = getReadableXtreamErrorMessage(
            error,
            transport.translate.instant(
                'PORTALS.REQUEST_ERRORS.XTREAM_CONNECTION'
            )
        );
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
        void transport.snackBar.open(
            transport.translate.instant('PORTALS.REQUEST_ERRORS.XTREAM', {
                message: normalizedMessage,
            }),
            transport.translate.instant('CLOSE'),
            { duration: 5000 }
        );
        return result;
    }
}

function getReadableXtreamErrorMessage(
    error: unknown,
    fallback: string
): string {
    if (!error) {
        return fallback;
    }

    const maybeError = error as {
        message?: unknown;
        statusText?: unknown;
        error?: unknown;
    };

    if (typeof maybeError.message === 'string') {
        if (maybeError.message.includes('[object Object]')) {
            if (typeof maybeError.error === 'string') {
                return maybeError.error;
            }
            if (
                maybeError.error &&
                typeof maybeError.error === 'object' &&
                'message' in (maybeError.error as Record<string, unknown>) &&
                typeof (maybeError.error as Record<string, unknown>).message ===
                    'string'
            ) {
                return (maybeError.error as Record<string, string>).message;
            }
            return fallback;
        }
        return maybeError.message;
    }

    if (typeof maybeError.statusText === 'string') {
        return maybeError.statusText;
    }

    if (typeof error === 'string') {
        return error;
    }

    return fallback;
}
