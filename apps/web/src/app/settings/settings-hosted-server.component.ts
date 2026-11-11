import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    computed,
    signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { QRCodeComponent } from 'angularx-qrcode';
import { parseHostedHttpsOrigin } from '@iptvnator/shared/interfaces';
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
        NgTemplateOutlet,
        SettingsSyncStatusComponent,
        MatIconModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatSelectModule,
        MatInputModule,
        MatRadioModule,
        FormsModule,
        QRCodeComponent,
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
    readonly accessMethod = signal<'local' | 'https'>('local');
    readonly httpsAddress = signal('');
    readonly httpsInvalid = signal(false);
    readonly qrAddress = signal('');
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
        command: Exclude<HostedServerCommand, 'status'>,
        httpsOrigin?: string
    ): Promise<void> {
        if (this.busy()) return;
        const httpsCommand =
            typeof command === 'object' && 'httpsOrigin' in command;
        this.transition++;
        this.busy.set(true);
        this.code.set('');
        this.feedback.set('');
        this.status.update((current) => ({
            ...current,
            state: httpsCommand
                ? current.state
                : command === 'stop'
                  ? 'stopping'
                  : 'starting',
            error: undefined,
        }));
        try {
            const status = await window.electron.hostedServerControl!(command);
            this.status.set(status);
            if (httpsOrigin && status.state === 'running') {
                this.status.set(
                    await window.electron.hostedServerControl!({ httpsOrigin })
                );
            }
        } catch {
            if (httpsCommand || this.status().state === 'running') {
                this.status.update((current) => ({
                    ...current,
                    httpsError: true,
                }));
            } else {
                this.status.set({ state: 'error', error: 'startup' });
            }
        } finally {
            this.busy.set(false);
        }
    }

    start(): void {
        if (this.busy()) return;
        const address = this.shareLan() ? this.address() : '';
        if (address === undefined) return;
        const useHttps = this.accessMethod() === 'https';
        const httpsOrigin = useHttps ? this.readHttpsOrigin() : undefined;
        if (useHttps && !httpsOrigin) return;
        void this.control(
            address ? { start: true, lanAddress: address } : { start: true },
            httpsOrigin
        );
    }

    enableHttps(): void {
        if (this.status().state !== 'running') return;
        const httpsOrigin = this.readHttpsOrigin();
        if (httpsOrigin) void this.control({ httpsOrigin });
    }

    private readHttpsOrigin(): string | undefined {
        try {
            const origin = parseHostedHttpsOrigin(
                this.httpsAddress().trim()
            ).origin;
            this.httpsInvalid.set(false);
            return origin;
        } catch {
            this.httpsInvalid.set(true);
            return undefined;
        }
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
