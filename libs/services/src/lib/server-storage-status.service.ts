import { computed, Injectable, signal } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import {
    clearServerAccessToken,
    readServerAccessToken,
} from './server-access-token';

export type ServerConnectionState =
    'inactive' | 'online' | 'offline' | 'unauthorized';

/** Where server mode asks for the access token. */
export const SERVER_SIGN_IN_PATH = '/server-sign-in';

/**
 * Connection state of the self-hosted server storage. `inactive` in Electron
 * and in a PWA without server storage; the server session activates it.
 */
@Injectable({ providedIn: 'root' })
export class ServerStorageStatusService {
    private readonly stateSignal = signal<ServerConnectionState>('inactive');
    private readonly instanceSignal = signal<ServerInstanceInfo | null>(null);
    private readonly lastSuccessSignal = signal<Date | null>(null);
    private retryHandler: (() => void) | null = null;
    private verified = true;

    readonly state = this.stateSignal.asReadonly();
    readonly instance = this.instanceSignal.asReadonly();
    readonly lastSuccessAt = this.lastSuccessSignal.asReadonly();
    readonly isActive = computed(() => this.stateSignal() !== 'inactive');

    /**
     * `verified` is false for a start from a remembered instance that did
     * not answer: the address may lead to another server by now. So it is
     * after going offline, until the instance is checked again.
     */
    activate(
        instance: ServerInstanceInfo,
        retry: () => void,
        verified = true
    ): void {
        this.instanceSignal.set(instance);
        this.retryHandler = retry;
        this.verified = verified;
        this.stateSignal.set('online');
    }

    /** The instance at the address turned out to be the remembered one. */
    markVerified(): void {
        this.verified = true;
    }

    /** Whether the token and writes may go out (see `activate`). */
    isVerified(): boolean {
        return this.verified;
    }

    /**
     * The stored token, only while server mode runs on an instance this
     * start verified: a token must never reach a server it was not given
     * for.
     */
    accessToken(): string | null {
        const instance = this.instanceSignal();
        return instance && this.isActive() && this.verified
            ? readServerAccessToken(instance.instanceId)
            : null;
    }

    reportSuccess(): void {
        // A late answer to a request sent with the old token must not undo
        // sign-out; only a reload after a new token leaves this state.
        if (!this.isActive() || this.stateSignal() === 'unauthorized') {
            return;
        }
        this.stateSignal.set('online');
        this.lastSuccessSignal.set(new Date());
    }

    reportOffline(): void {
        if (!this.isActive()) {
            return;
        }
        // It may come back as another database (a replaced volume at the
        // same address): no token, no writes until it is checked, also
        // from the sign-in page.
        this.verified = false;
        // A late failure after sign-out must not unlock the workspace.
        if (this.stateSignal() !== 'unauthorized') {
            this.stateSignal.set('offline');
        }
    }

    reportUnauthorized(): void {
        if (this.isActive()) {
            this.stateSignal.set('unauthorized');
        }
    }

    /**
     * The access guard refused a request sent with `sentToken`: the token
     * stored for this instance is stale or missing, ask for a new one.
     */
    reportAccessDenied(sentToken: string | null): void {
        const instance = this.instanceSignal();
        // A late answer to a token replaced since (a new sign-in) is moot,
        // and so is one to a page that held its token back until the
        // instance is checked.
        if (
            !instance ||
            !this.isActive() ||
            readServerAccessToken(instance.instanceId) !== sentToken
        ) {
            return;
        }
        if (sentToken) {
            clearServerAccessToken();
        }
        this.stateSignal.set('unauthorized');
    }

    retry(): void {
        this.retryHandler?.();
    }
}
