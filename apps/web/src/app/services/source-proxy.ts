import {
    assertSourceRequestAllowed,
    sourceAuthorization,
    verifySourceInstance,
} from '@iptvnator/services/source-sync/authorization';
import {
    HttpErrorResponse,
    type HttpInterceptorFn,
} from '@angular/common/http';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { isGatewayOutage } from '@iptvnator/services';
import {
    invalidateSourceVerification,
    sourceConnection,
    sourceVerificationEpoch,
} from '@iptvnator/services/source-sync/connection';

let pending: { epoch: number; promise: Promise<void> } | undefined;

export { invalidateSourceVerification } from '@iptvnator/services/source-sync/connection';
export function sourceProxyHeaders(url: string): Record<string, string> {
    assertSourceRequestAllowed(url);
    return sourceAuthorization(url);
}

/** An outage revokes the identity proof for both provider transports. */
export async function ensureSourceProxy(url: string): Promise<void> {
    try {
        assertSourceRequestAllowed(url);
        return;
    } catch {
        const connection = sourceConnection();
        const epoch = sourceVerificationEpoch();
        if (!pending || pending.epoch !== epoch) {
            const promise = (async () => {
                const response = await fetch(
                    `${connection!.apiUrl}/v1/instance`,
                    {
                        redirect: 'error',
                        cache: 'no-store',
                        signal: AbortSignal.timeout(5000),
                    }
                );
                if (!response.ok) throw new Error('SOURCE_SYNC.OFFLINE');
                verifySourceInstance(await response.json(), connection, epoch);
            })();
            pending = { epoch, promise };
            void promise
                .finally(() => {
                    if (pending?.promise === promise) pending = undefined;
                })
                .catch(() => undefined);
        }
        await pending.promise;
        assertSourceRequestAllowed(url);
    }
}

export const interceptSourceProxy: HttpInterceptorFn = (request, next) =>
    from(ensureSourceProxy(request.url)).pipe(
        switchMap(() => {
            assertSourceRequestAllowed(request.url);
            return next(
                request.clone({ setHeaders: sourceAuthorization(request.url) })
            );
        }),
        catchError((error: unknown) => {
            if (
                error instanceof HttpErrorResponse &&
                (error.status === 0 ||
                    isGatewayOutage(
                        error.status,
                        error.headers.get('content-type')
                    ))
            )
                invalidateSourceVerification();
            return throwError(() => error);
        })
    );
