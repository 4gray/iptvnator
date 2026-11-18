import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';

type UpdateNotice = 'ready' | 'failed' | 'unrecoverable';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
    private readonly updates = inject(SwUpdate, { optional: true });
    private readonly destroyRef = inject(DestroyRef);
    readonly notice = signal<UpdateNotice | null>(null);
    readonly checking = signal(false);
    readonly noUpdate = signal(false);
    readonly enabled = this.updates?.isEnabled === true;
    readonly canReload = computed(() => {
        const notice = this.notice();
        return notice === 'ready' || notice === 'unrecoverable';
    });
    readonly noticeMessage = computed(() => {
        switch (this.notice()) {
            case 'ready':
                return 'PWA_UPDATE_READY';
            case 'failed':
                return 'PWA_UPDATE_FAILED';
            case 'unrecoverable':
                return 'PWA_RELOAD_REQUIRED';
            default:
                return '';
        }
    });

    reloadWindow = () => window.location.reload();

    constructor() {
        if (!this.updates?.isEnabled) return;
        this.updates.versionUpdates
            .pipe(takeUntilDestroyed())
            .subscribe((event) => {
                if (event.type === 'VERSION_READY') this.notify('ready');
                if (event.type === 'VERSION_INSTALLATION_FAILED')
                    this.notify('failed');
                if (event.type === 'NO_NEW_VERSION_DETECTED') {
                    this.noUpdate.set(true);
                    if (this.notice() === 'failed') this.notice.set(null);
                }
            });
        this.updates.unrecoverable
            .pipe(takeUntilDestroyed())
            .subscribe(() => this.notify('unrecoverable'));
        const worker = navigator.serviceWorker;
        const checkWhenVisible = () => {
            if (
                worker?.controller &&
                navigator.onLine &&
                document.visibilityState === 'visible'
            ) {
                void this.check();
            }
        };
        window.addEventListener('online', checkWhenVisible);
        document.addEventListener('visibilitychange', checkWhenVisible);
        worker?.addEventListener('controllerchange', checkWhenVisible);
        this.destroyRef.onDestroy(() => {
            window.removeEventListener('online', checkWhenVisible);
            document.removeEventListener('visibilitychange', checkWhenVisible);
            worker?.removeEventListener('controllerchange', checkWhenVisible);
        });
        checkWhenVisible();
    }

    act(): void {
        if (this.notice() === 'failed') void this.check();
        else if (this.notice()) this.reloadWindow();
    }

    async check(): Promise<void> {
        if (!this.updates?.isEnabled || this.checking()) return;
        this.noUpdate.set(false);
        if (!navigator.serviceWorker?.controller) {
            this.notify('failed');
            return;
        }
        this.checking.set(true);
        try {
            const found = await this.updates.checkForUpdate();
            if (found) this.notify('ready');
            // A failed manifest fetch returns false without sending a version event.
            else if (!this.noUpdate()) this.notify('failed');
        } catch {
            this.notify('failed');
        } finally {
            this.checking.set(false);
        }
    }

    private notify(state: UpdateNotice): void {
        if (state === 'failed' && this.canReload()) return;
        this.noUpdate.set(false);
        this.notice.set(state);
    }
}
