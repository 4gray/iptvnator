import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, fromEvent, take } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
    private readonly updates = inject(SwUpdate);
    private readonly snackBar = inject(LazySnackBar);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);
    private checking = false;
    private notice = 0;

    reloadWindow = () => window.location.reload();

    constructor() {
        if (!this.updates.isEnabled) return;
        this.updates.versionUpdates
            .pipe(takeUntilDestroyed())
            .subscribe((event) => {
                if (event.type === 'VERSION_READY') void this.notify('ready');
                if (event.type === 'VERSION_INSTALLATION_FAILED')
                    void this.notify('failed');
            });
        this.updates.unrecoverable
            .pipe(takeUntilDestroyed())
            .subscribe(() => void this.notify('unrecoverable'));
        fromEvent(window, 'online')
            .pipe(takeUntilDestroyed())
            .subscribe(() => void this.check());
    }

    private async check(): Promise<void> {
        if (this.checking) return;
        this.checking = true;
        try {
            await this.updates.checkForUpdate();
        } catch {
            void this.notify('failed');
        } finally {
            this.checking = false;
        }
    }

    private async notify(
        state: 'ready' | 'failed' | 'unrecoverable'
    ): Promise<void> {
        const ready = state !== 'failed';
        const notice = ++this.notice;
        const message =
            state === 'unrecoverable'
                ? 'PWA_RELOAD_REQUIRED'
                : ready
                  ? 'PWA_UPDATE_READY'
                  : 'PWA_UPDATE_FAILED';
        const action = ready ? 'REFRESH' : 'RETRY';
        const labels = await firstValueFrom(
            this.translate.get([message, action])
        );
        if (this.destroyRef.destroyed || notice !== this.notice) return;
        const ref = await this.snackBar.open(labels[message], labels[action], {
            duration: 0,
        });
        if (this.destroyRef.destroyed || notice !== this.notice) {
            ref?.dismiss();
            return;
        }
        ref?.onAction()
            .pipe(take(1), takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (ready) this.reloadWindow();
                else void this.check();
            });
    }
}
