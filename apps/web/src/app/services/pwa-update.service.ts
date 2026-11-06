import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';

type UpdateNotice = 'ready' | 'failed' | 'unrecoverable';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
    private readonly updates = inject(SwUpdate);
    private readonly destroyRef = inject(DestroyRef);
    private versionEvent = 0;
    private reloadState?: 'ready' | 'unrecoverable';
    readonly notice = signal<UpdateNotice | null>(null);
    readonly checking = signal(false);

    reloadWindow = () => window.location.reload();

    constructor() {
        if (!this.updates.isEnabled) return;
        this.updates.versionUpdates
            .pipe(takeUntilDestroyed())
            .subscribe((event) => {
                this.versionEvent++;
                if (event.type === 'VERSION_READY') this.notify('ready');
                if (event.type === 'VERSION_INSTALLATION_FAILED')
                    this.notify('failed');
                if (
                    event.type === 'NO_NEW_VERSION_DETECTED' &&
                    this.notice() === 'failed'
                )
                    this.notice.set(null);
            });
        this.updates.unrecoverable
            .pipe(takeUntilDestroyed())
            .subscribe(() => this.notify('unrecoverable'));
        const online = () => void this.check();
        window.addEventListener('online', online);
        this.destroyRef.onDestroy(() =>
            window.removeEventListener('online', online)
        );
    }

    act(): void {
        if (this.notice() === 'failed') void this.check();
        else if (this.notice()) this.reloadWindow();
    }

    private async check(): Promise<void> {
        if (this.checking()) return;
        this.checking.set(true);
        const versionEvent = this.versionEvent;
        try {
            const found = await this.updates.checkForUpdate();
            // The worker returns false without an event when the manifest fetch fails.
            if (!found && versionEvent === this.versionEvent)
                this.notify('failed');
        } catch {
            this.notify('failed');
        } finally {
            this.checking.set(false);
        }
    }

    private notify(state: UpdateNotice): void {
        if (state === 'failed') state = this.reloadState ?? state;
        else this.reloadState = state;
        this.notice.set(state);
    }
}
