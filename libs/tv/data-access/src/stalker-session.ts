import {
    StalkerAuthApi,
    buildStalkerEndpointCandidates,
    classifyStalkerProbeResponse,
} from '@iptvnator/portal/stalker/client';
import {
    isFullStalkerPortalPlaylist,
    isStalkerAuthFailureResponse,
    normalizeStalkerMacAddress,
} from '@iptvnator/shared/interfaces';
import { Source } from '@iptvnator/tv/util';
import { ProviderRequestError, ProviderTransport } from './transport';
/** One source, one serialized repair. Credentials never leave this configured backend. */
export class StalkerSession {
    private repair?: Promise<void>;
    private watchdog?: ReturnType<typeof setInterval>;
    private lifetime = new AbortController();
    private auth: StalkerAuthApi;
    constructor(
        readonly source: Source,
        private readonly transport: ProviderTransport,
        private readonly save: (source: Source) => Promise<void>
    ) {
        this.auth = new StalkerAuthApi(
            {
                sendIpcEvent: async <T>(
                    _type: string,
                    payload?: unknown
                ): Promise<T> => {
                    const p = payload as {
                        url: string;
                        token?: string;
                        params: Record<string, string>;
                    };
                    return this.raw(
                        p.params,
                        this.authSignal,
                        p.url,
                        p.token
                    ) as Promise<T>;
                },
            },
            {
                error() {
                    /* UI reports a redacted failure; no raw credentials in logs. */
                },
            }
        );
    }
    private authSignal = this.lifetime.signal;
    raw(
        params: Record<string, string | number>,
        signal: AbortSignal,
        endpoint = this.source.endpoint ?? this.source.url,
        token = this.source.token
    ) {
        return this.transport.request(
            this.source,
            'stalker',
            {
                ...params,
                macAddress: this.source.macAddress ?? '',
                ...(this.source.serialNumber
                    ? { serialNumber: this.source.serialNumber }
                    : {}),
                ...(token ? { token } : {}),
            },
            signal,
            endpoint
        );
    }
    async discover(signal: AbortSignal) {
        // Normalize at source entry only. An existing account identity is never rewritten on read.
        if (!normalizeStalkerMacAddress(this.source.macAddress))
            throw new Error('Enter a valid MAC address.');
        if (this.source.endpoint && this.source.full !== undefined) {
            if (
                isFullStalkerPortalPlaylist({
                    isFullStalkerPortal: this.source.full,
                })
            )
                await this.authenticate(signal);
            return this.source;
        }
        for (const endpoint of buildStalkerEndpointCandidates(
            this.source.url
        )) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            let classification;
            try {
                classification = classifyStalkerProbeResponse(
                    await this.raw(
                        {
                            action: 'get_genres',
                            type: 'itv',
                            skipConnectionGuard: 'true',
                        },
                        signal,
                        endpoint,
                        ''
                    )
                );
            } catch {
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                continue;
            }
            if (classification === 'not-a-portal') continue;
            this.source.endpoint = endpoint;
            this.source.full = classification === 'auth-required';
            if (this.source.full) await this.authenticate(signal);
            await this.save({ ...this.source });
            return this.source;
        }
        throw new Error(
            'No Stalker endpoint answered. Check the portal address and backend access.'
        );
    }
    private async authenticate(signal: AbortSignal) {
        this.authSignal = signal;
        const result = await this.auth.authenticate(
            this.source.endpoint ?? this.source.url,
            this.source.macAddress ?? '',
            this.source,
            {
                storedToken: this.source.token,
                skipProfileWhenReused: true,
                signal,
                credentials: this.source,
            }
        );
        if (signal.aborted || this.lifetime.signal.aborted)
            throw new DOMException('Aborted', 'AbortError');
        this.source.token = result.token;
        await this.save({ ...this.source });
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = setInterval(
            () => {
                this.request(
                    { type: 'stb', action: 'get_events' },
                    this.lifetime.signal
                ).catch(() => undefined);
            },
            Math.max(30, result.watchdogTimeoutSeconds ?? 120) * 1000
        );
    }
    async request(
        params: Record<string, string | number>,
        signal: AbortSignal
    ): Promise<unknown> {
        const failedToken = this.source.token;
        let result;
        try {
            result = await this.raw(params, signal);
        } catch (error) {
            if (
                error instanceof ProviderRequestError &&
                error.upstream &&
                [401, 403].includes(error.status)
            )
                result = 'Authorization failed.';
            else throw error;
        }
        if (isStalkerAuthFailureResponse(result)) {
            if (this.source.token && this.source.token !== failedToken)
                return this.request(params, signal);
            if (!this.repair)
                this.repair = (async () => {
                    this.source.token = undefined;
                    this.source.full = true;
                    await this.authenticate(this.lifetime.signal);
                })().finally(() => {
                    this.repair = undefined;
                });
            await this.repair;
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            result = await this.raw(params, signal);
            if (isStalkerAuthFailureResponse(result))
                throw new Error(
                    'Stalker rejected the session. Check account access and device identity.'
                );
        }
        const js = (result as { js?: { error?: unknown } })?.js;
        if (js && typeof js === 'object' && js.error)
            throw new Error('Stalker could not complete this request.');
        return result;
    }
    dispose() {
        this.lifetime.abort();
        if (this.watchdog) clearInterval(this.watchdog);
    }
}
