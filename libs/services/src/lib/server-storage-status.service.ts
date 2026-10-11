import { computed, Injectable, signal } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';

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
        if (!this.isActive()) {
            return;
        }
        this.stateSignal.set('online');
        this.lastSuccessSignal.set(new Date());
    }

    reportOffline(): void {
        if (this.isActive()) {
            this.stateSignal.set('offline');
        }
    }

    reportUnauthorized(): void {
        if (this.isActive()) {
            this.stateSignal.set('unauthorized');
        }
    }

    retry(): void {
        this.retryHandler?.();
    }
}
