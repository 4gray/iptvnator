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
import { SettingsHostedDevicesComponent } from './settings-hosted-devices.component';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { TranslateModule } from '@ngx-translate/core';
import type {
    HostedCloudflareCommand,
    HostedCloudflareStatus,
    HostedServerCommand,
    HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { timer } from 'rxjs';

type CloudflareStart = Extract<HostedCloudflareCommand, { start: true }>;
type AccessMethod = 'lan' | 'https' | 'cloudflare';

const unavailableConnector: HostedCloudflareStatus = {
    state: 'unavailable',
    savedToken: false,
    secureStorage: false,
};

function shareableUrl(
    value: string | undefined,
    protocol: 'http:' | 'https:'
): string {
    if (!value) return '';
    try {
        const url = new URL(value);
        const host = url.hostname.replace(/\.$/, '');
        const validHost =
            protocol === 'http:'
                ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) &&
                  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
                : !/^(127\.|0\.|\[::1\]$|\[::\]$|\[::ffff:)/.test(host) &&
                  host !== 'localhost' &&
                  !host.endsWith('.localhost');
        return url.protocol === protocol && validHost ? value : '';
    } catch {
        return '';
    }
}

@Component({
    selector: 'app-settings-hosted-server',
    providers: [provideFormFieldDefaults()],
    imports: [
        NgTemplateOutlet,
        SettingsHostedDevicesComponent,
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
    styleUrls: [
        './settings-server-section.component.scss',
        './settings-hosted-server.component.scss',
    ],
})
export class SettingsHostedServerComponent {
    readonly guides = SERVER_GUIDES;
    readonly deviceControlAvailable = !!window.electron?.hostedDeviceControl;
    readonly accessOptions = [
        { value: 'lan', label: 'HOME_NETWORK' },
        { value: 'https', label: 'CUSTOM_HTTPS' },
        { value: 'cloudflare', label: 'MANUAL_CLOUDFLARE' },
    ] as const;
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
    readonly lanSetup = signal(false);
    readonly addressChoice = signal('');
    readonly addresses = computed(() => this.status().availableAddresses ?? []);
    readonly address = computed(() => {
        const selected = this.addressChoice() || this.status().lanAddress;
        return selected && this.addresses().includes(selected)
            ? selected
            : this.addresses()[0];
    });
    readonly code = signal('');
    readonly feedback = signal('');
    readonly accessChoice = signal<AccessMethod | null>(null);
    readonly accessMethod = computed(() => {
        const choice = this.accessChoice();
        if (choice && (choice !== 'cloudflare' || this.cloudflareAvailable()))
            return choice;
        return 'lan';
    });
    readonly remoteSelected = computed(
        () =>
            this.accessMethod() === 'https' ||
            this.accessMethod() === 'cloudflare'
    );
    readonly httpsAddress = signal('');
    readonly httpsInvalid = signal(false);
    readonly qrAddress = signal('');
    readonly lanUrl = computed(() =>
        shareableUrl(this.status().lanUrl, 'http:')
    );
    readonly httpsQrAddress = computed(() =>
        shareableUrl(this.status().httpsOrigin, 'https:')
    );
    readonly cloudflare = signal(unavailableConnector);
    readonly cloudflareAvailable = computed(
        () =>
            this.cloudflare().state !== 'unavailable' &&
            !this.connectorStatusUnknown()
    );
    readonly cloudflareToken = signal('');
    readonly cloudflareProtected = signal(false);
    readonly cloudflareVerified = signal(false);
    readonly cloudflareError = signal('');
    readonly canStartCloudflare = computed(
        () =>
            this.cloudflareAvailable() &&
            !this.connectorStatusUnknown() &&
            this.cloudflare().secureStorage &&
            this.cloudflareProtected() &&
            (!!this.cloudflareToken().trim() || this.cloudflare().savedToken)
    );
    readonly httpsSetupComplete = computed(
        () =>
            !!this.httpsAddress().trim() &&
            (this.accessMethod() !== 'cloudflare' || this.canStartCloudflare())
    );
    private readonly cloudflareIngress = signal(false);
    private readonly connectorStatusUnknown = signal(false);
    readonly isCloudflareHttps = computed(
        () =>
            this.cloudflareIngress() ||
            (this.cloudflareAvailable() &&
                this.cloudflare().state !== 'stopped')
    );
    readonly canShareHttps = computed(
        () =>
            !this.connectorStatusUnknown() &&
            (!this.isCloudflareHttps() ||
                (!this.busy() &&
                    this.cloudflare().state === 'running' &&
                    this.cloudflareVerified()))
    );
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
            const [status, cloudflare] = await Promise.all([
                window.electron.hostedServerControl!('status'),
                window.electron
                    .hostedCloudflareControl?.('status')
                    .catch(() => null),
            ]);
            if (transition !== this.transition) return;
            this.connectorStatusUnknown.set(cloudflare === null);
            if (cloudflare) this.cloudflare.set(cloudflare);
            if (cloudflare?.state !== 'running')
                this.cloudflareVerified.set(false);
            this.status.set(status);
            if (status.state !== 'running') this.code.set('');
            if (!status.httpsOrigin) this.cloudflareIngress.set(false);
        } catch {
            if (transition === this.transition)
                this.status.set({ state: 'error', error: 'startup' });
        }
    }

    async control(
        command: Exclude<HostedServerCommand, 'status'>,
        httpsOrigin?: string,
        cloudflareStart?: CloudflareStart
    ): Promise<void> {
        if (this.busy()) return;
        const httpsCommand =
            typeof command === 'object' && 'httpsOrigin' in command;
        const restartCommand =
            typeof command === 'object' && 'restart' in command;
        this.transition++;
        this.busy.set(true);
        this.code.set('');
        this.qrAddress.set('');
        this.feedback.set('');
        this.cloudflareError.set('');
        this.cloudflareVerified.set(false);
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
            let status = await window.electron.hostedServerControl!(command);
            this.status.set(status);
            if (httpsOrigin && status.state === 'running') {
                status = await window.electron.hostedServerControl!({
                    httpsOrigin,
                });
                this.status.set(status);
            }
            if (cloudflareStart && status.httpsOrigin && !status.httpsError)
                await this.startCloudflare(cloudflareStart);
            if (!this.status().httpsOrigin) this.cloudflareIngress.set(false);
            if (command === 'stop' || restartCommand) {
                this.lanSetup.set(false);
                this.cloudflareProtected.set(false);
            }
            if (restartCommand && this.lanUrl()) this.accessChoice.set(null);
        } catch {
            if (restartCommand) {
                await this.readStatus();
                this.feedback.set('HOSTED_SERVER.LAN_RESTART_FAILED');
            } else if (httpsCommand || this.status().state === 'running') {
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

    restartForLan(): void {
        const address = this.address();
        const status = this.status();
        if (
            !this.lanSetup() ||
            status.state !== 'running' ||
            status.httpsOrigin ||
            this.lanUrl() ||
            !address
        )
            return;
        void this.control({ restart: true, lanAddress: address });
    }

    start(): void {
        if (this.busy()) return;
        const address = this.accessMethod() === 'lan' ? this.address() : '';
        if (address === undefined) return;
        const useHttps = this.remoteSelected();
        const useCloudflare = this.accessMethod() === 'cloudflare';
        if (useCloudflare && !this.canStartCloudflare()) return;
        const httpsOrigin = useHttps ? this.readHttpsOrigin() : undefined;
        if (useHttps && !httpsOrigin) return;
        if (useCloudflare) this.cloudflareIngress.set(true);
        void this.control(
            address ? { start: true, lanAddress: address } : { start: true },
            httpsOrigin,
            useCloudflare ? this.cloudflareStartCommand() : undefined
        );
    }

    enableHttps(): void {
        if (this.status().state !== 'running' || this.busy()) return;
        const useCloudflare = this.accessMethod() === 'cloudflare';
        if (useCloudflare && !this.canStartCloudflare()) return;
        const httpsOrigin = this.readHttpsOrigin();
        if (!httpsOrigin) return;
        if (useCloudflare) this.cloudflareIngress.set(true);
        void this.control(
            { httpsOrigin },
            undefined,
            useCloudflare ? this.cloudflareStartCommand() : undefined
        );
    }

    async stopHttps(): Promise<void> {
        await this.control({ httpsOrigin: '' });
        if (!this.status().httpsOrigin) {
            this.accessChoice.set(null);
            this.cloudflareProtected.set(false);
        }
    }

    editHttpsAddress(value: string): void {
        if (value !== this.httpsAddress()) this.cloudflareProtected.set(false);
        this.httpsAddress.set(value);
        this.httpsInvalid.set(false);
    }

    async forgetCloudflare(): Promise<void> {
        if (this.busy()) return;
        this.transition++;
        this.busy.set(true);
        this.cloudflareError.set('');
        try {
            this.cloudflare.set(
                await window.electron.hostedCloudflareControl!('forget')
            );
            this.cloudflareToken.set('');
        } catch {
            this.cloudflareError.set('HOSTED_SERVER.CLOUDFLARE_FORGET_FAILED');
        } finally {
            this.busy.set(false);
        }
    }

    private cloudflareStartCommand(): CloudflareStart {
        const token = this.cloudflareToken().trim();
        return token ? { start: true, token } : { start: true };
    }

    private async startCloudflare(command: CloudflareStart): Promise<void> {
        this.cloudflareToken.set('');
        try {
            const result =
                await window.electron.hostedCloudflareControl!(command);
            this.cloudflare.set(result);
            if (result.state === 'running') return;
        } catch {
            // Bridge errors can contain credential or process details.
        }
        this.cloudflareError.set('HOSTED_SERVER.CLOUDFLARE_FAILED');
        const status = await window.electron.hostedServerControl!({
            httpsOrigin: '',
        });
        this.status.set(status);
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
        const transition = this.transition;
        try {
            const code = await window.electron.hostedServerAccessCode!();
            if (transition === this.transition) this.code.set(code);
        } catch {
            this.feedback.set('HOSTED_SERVER.CODE_FAILED');
        }
    }
}
