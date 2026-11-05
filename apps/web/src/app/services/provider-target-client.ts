import {
    catchError,
    defer,
    firstValueFrom,
    from,
    Observable,
    switchMap,
    throwError,
} from 'rxjs';

/** Registration cache and one recovery attempt, shared by HTTP and fetch calls. */
export class ProviderTargetClient {
    private readonly targets = new Map<string, Promise<string>>();

    constructor(private readonly register: (url: string) => Promise<string>) {}

    request<T>(
        url: string,
        send: (id: string) => Observable<T>
    ): Observable<T> {
        return defer(() => {
            const registration = this.get(url);
            return from(registration).pipe(
                switchMap(send),
                catchError((error: unknown) => {
                    if (!isMissingTarget(error)) return throwError(() => error);
                    // A slower stale request must not remove a newer registration.
                    if (this.targets.get(url) === registration)
                        this.targets.delete(url);
                    return from(this.get(url)).pipe(switchMap(send));
                })
            );
        });
    }

    fetch(
        url: string,
        send: (id: string) => Promise<Response>
    ): Promise<Response> {
        return firstValueFrom(
            this.request(url, (id) =>
                defer(async () => {
                    const response = await send(id);
                    if (response.status === 404) {
                        const body: unknown = await response
                            .json()
                            .catch(() => undefined);
                        const error = Object.assign(
                            new Error('Provider target not found'),
                            {
                                status: 404,
                                error: body,
                            }
                        );
                        if (isMissingTarget(error)) throw error;
                    }
                    return response;
                })
            )
        );
    }

    private get(url: string): Promise<string> {
        const cached = this.targets.get(url);
        if (cached) return cached;
        const pending = this.register(url).catch((error: unknown) => {
            if (this.targets.get(url) === pending) this.targets.delete(url);
            throw error;
        });
        // Bound the browser cache too; evicted URLs register normally next time.
        if (this.targets.size >= 256) {
            const oldest = this.targets.keys().next().value;
            if (oldest !== undefined) this.targets.delete(oldest);
        }
        this.targets.set(url, pending);
        return pending;
    }
}

function isMissingTarget(error: unknown): boolean {
    const failure = error as {
        status?: number;
        error?: { code?: string; message?: string };
    } | null;
    return (
        failure?.status === 404 &&
        (failure.error?.code === 'PROVIDER_TARGET_NOT_FOUND' ||
            // A browser update may precede its backend update.
            (failure.error?.code === undefined &&
                failure.error?.message === 'Provider target not found'))
    );
}
