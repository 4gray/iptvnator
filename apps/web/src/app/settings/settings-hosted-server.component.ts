import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    computed,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { SERVER_GUIDES } from './settings-server-about-dialog.component';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { TranslateModule } from '@ngx-translate/core';
import type {
    HostedServerCommand,
    HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { timer } from 'rxjs';

@Component({
    selector: 'app-settings-hosted-server',
    providers: [provideFormFieldDefaults()],
    imports: [
        SettingsSyncStatusComponent,
        MatIconModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatSelectModule,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './settings-hosted-server.component.html',
    styleUrl: './settings-server-section.component.scss',
})
export class SettingsHostedServerComponent {
    readonly guides = SERVER_GUIDES;
    readonly stateKeys = {
        unavailable: '',
        stopped: 'HOSTED_SERVER.STATE_stopped',
        starting: 'HOSTED_SERVER.STATE_starting',
        running: 'HOSTED_SERVER.STATE_running',
        stopping: 'HOSTED_SERVER.STATE_stopping',
        error: 'HOSTED_SERVER.STATE_error',
    } satisfies Record<HostedServerStatus['state'], string>;
    readonly errorKeys = {
        port: 'HOSTED_SERVER.ERROR_port',
        startup: 'HOSTED_SERVER.ERROR_startup',
    };
    readonly status = signal<HostedServerStatus>({ state: 'unavailable' });
    readonly busy = signal(false);
    readonly lanChoice = signal<boolean | null>(null);
    readonly addressChoice = signal('');
    readonly shareLan = computed(
        () => this.lanChoice() ?? !!this.status().lanAddress
    );
    readonly addresses = computed(() => this.status().availableAddresses ?? []);
    readonly address = computed(() => {
        const selected = this.addressChoice() || this.status().lanAddress;
        return selected && this.addresses().includes(selected)
            ? selected
            : this.addresses()[0];
    });
    readonly code = signal('');
    readonly feedback = signal('');
    private transition = 0;
    private readonly clipboard = inject(Clipboard);
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        timer(0, 3000)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (!this.busy()) void this.readStatus();
            });
    }

    private async readStatus(): Promise<void> {
        const transition = this.transition;
        try {
            const status = await window.electron.hostedServerControl!('status');
            if (transition !== this.transition) return;
            this.status.set(status);
            if (status.state !== 'running') this.code.set('');
        } catch {
            if (transition === this.transition)
                this.status.set({ state: 'error', error: 'startup' });
        }
    }

    async control(
        command: Exclude<HostedServerCommand, 'status'>
    ): Promise<void> {
        if (this.busy()) return;
        this.transition++;
        this.busy.set(true);
        this.code.set('');
        this.feedback.set('');
        this.status.update((current) => ({
            ...current,
            state: command === 'stop' ? 'stopping' : 'starting',
            error: undefined,
        }));
        try {
            this.status.set(
                await window.electron.hostedServerControl!(command)
            );
        } catch {
            this.status.set({ state: 'error', error: 'startup' });
        } finally {
            this.busy.set(false);
        }
    }

    start(): void {
        const address = this.shareLan() ? this.address() : '';
        if (address === undefined) return;
        void this.control(
            address ? { start: true, lanAddress: address } : { start: true }
        );
    }

    copyAddress(address: string): void {
        this.feedback.set(
            this.clipboard.copy(address)
                ? 'HOSTED_SERVER.ADDRESS_COPIED'
                : 'HOSTED_SERVER.COPY_FAILED'
        );
    }

    async showCode(): Promise<void> {
        if (this.code()) {
            this.code.set('');
            return;
        }
        try {
            this.code.set(await window.electron.hostedServerAccessCode!());
        } catch {
            this.feedback.set('HOSTED_SERVER.CODE_FAILED');
        }
    }
}
