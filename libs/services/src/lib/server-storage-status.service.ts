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

    readonly state = this.stateSignal.asReadonly();
    readonly instance = this.instanceSignal.asReadonly();
    readonly lastSuccessAt = this.lastSuccessSignal.asReadonly();
    readonly isActive = computed(() => this.stateSignal() !== 'inactive');

    activate(instance: ServerInstanceInfo, retry: () => void): void {
        this.instanceSignal.set(instance);
        this.retryHandler = retry;
        this.stateSignal.set('online');
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
        // A late failure after sign-out must not unlock the workspace.
        if (this.isActive() && this.stateSignal() !== 'unauthorized') {
            this.stateSignal.set('offline');
        }
    }

    reportUnauthorized(): void {
        if (this.isActive()) {
            this.stateSignal.set('unauthorized');
        }
    }

    /**
     * The access guard refused a request outside the storage API (a
     * provider proxy call): the stored token is stale, ask for a new one.
     */
    reportAccessDenied(sentToken: string | null): void {
        // A late answer to a token replaced since (a new sign-in) is moot.
        if (this.isActive() && readServerAccessToken() === sentToken) {
            clearServerAccessToken();
            this.stateSignal.set('unauthorized');
        }
    }

    retry(): void {
        this.retryHandler?.();
    }
}
