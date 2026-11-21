import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    inject,
    input,
    linkedSignal,
    resource,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
    MAT_SLIDE_TOGGLE_DEFAULT_OPTIONS,
    MatSlideToggleModule,
} from '@angular/material/slide-toggle';
import {
    HOSTED_PAIRING_PASSWORD_MAX_LENGTH,
    HOSTED_PAIRING_PASSWORD_MIN_LENGTH,
} from '@iptvnator/shared/interfaces';
import type {
    HostedDeviceCommand,
    HostedDeviceInvite,
    HostedDeviceList,
    HostedDeviceResults,
} from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { timer } from 'rxjs';

@Component({
    selector: 'app-settings-hosted-devices',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSlideToggleModule,
        QRCodeComponent,
        TranslateModule,
    ],
    providers: [
        provideFormFieldDefaults(),
        {
            provide: MAT_SLIDE_TOGGLE_DEFAULT_OPTIONS,
            useValue: { disableToggleValue: true },
        },
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './settings-hosted-devices.component.html',
    styleUrls: [
        './settings-server-section.component.scss',
        './settings-hosted-server.component.scss',
        './settings-hosted-devices.component.scss',
    ],
})
export class SettingsHostedDevicesComponent {
    readonly lanAvailable = input.required<boolean>();
    readonly pairingUnavailableReason = input<string>();
    readonly deviceEndpoint = input<string>();
    readonly httpsOrigin = input<string>();
    readonly cloudflare = input(false);
    private readonly pairingTarget = computed(() =>
        this.lanAvailable()
            ? {
                  endpoint: this.deviceEndpoint(),
                  cloudflare: this.cloudflare(),
              }
            : null
    );
    readonly expanded = signal(false);
    readonly invite = linkedSignal({
        source: this.pairingTarget,
        computation: (): HostedDeviceInvite | null => null,
    });
    readonly inviteExpired = linkedSignal({
        source: this.pairingTarget,
        computation: () => false,
    });
    readonly list = signal<HostedDeviceList | null>(null);
    readonly listFailed = signal(false);
    readonly busy = signal(false);
    readonly message = signal('');
    readonly passwordMinLength = HOSTED_PAIRING_PASSWORD_MIN_LENGTH;
    readonly passwordMaxLength = HOSTED_PAIRING_PASSWORD_MAX_LENGTH;
    readonly passwordSettings = resource({
        params: () => this.httpsOrigin(),
        loader: () => this.request({ action: 'browser-settings' }),
    });
    readonly passwordBusy = signal(false);
    readonly passwordNotice = linkedSignal({
        source: this.httpsOrigin,
        computation: (): { key: string; error?: boolean } | null => null,
    });

    private readonly destroyRef = inject(DestroyRef);
    private readonly clipboard = inject(Clipboard);
    private readonly dialog = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private loading = false;

    constructor() {
        timer(2000, 2000)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                const invite = this.invite();
                if (invite && Date.parse(invite.expiresAt) <= Date.now()) {
                    this.invite.set(null);
                    this.inviteExpired.set(true);
                }
                if ((this.expanded() || (this.cloudflare() && this.invite())) && !this.busy())
                    void this.readDevices();
            });
    }

    toggleDevices(): void {
        this.expanded.update((expanded) => !expanded);
        if (this.expanded()) void this.readDevices();
    }

    async pair(): Promise<void> {
        const target = this.pairingTarget();
        if (!target) return;
        await this.run(async () => {
            this.inviteExpired.set(false);
            this.invite.set(null);
            const invite = await this.request({ action: 'invite' });
            if (this.destroyRef.destroyed || this.pairingTarget() !== target)
                return;
            this.invite.set(invite);
            this.expanded.set(true);
        });
    }

    async approve(claimId: string): Promise<void> {
        await this.run(async () => {
            await this.request({ action: 'approve', claimId });
            this.message.set('HOSTED_SERVER.PAIR_APPROVED');
        });
    }

    async setDeviceApproval(
        deviceId: string,
        canApprove: boolean
    ): Promise<void> {
        await this.run(async () => {
            await this.request({
                action: 'set-device-approval',
                deviceId,
                canApprove,
            });
        });
    }

    copyPairingLink(): void {
        const invite = this.invite();
        if (!invite || Date.parse(invite.expiresAt) <= Date.now()) return;
        this.message.set(
            this.clipboard.copy(invite.url)
                ? 'HOSTED_SERVER.PAIR_LINK_COPIED'
                : 'HOSTED_SERVER.COPY_FAILED'
        );
    }

    confirmRevoke(device: HostedDeviceList['devices'][number]): void {
        void this.dialog.openConfirmDialog({
            title: this.translate.instant('HOSTED_SERVER.REVOKE_DEVICE'),
            subtitle: device.name,
            message: this.translate.instant('HOSTED_SERVER.REVOKE_CONFIRM', {
                name: device.name,
            }),
            confirmLabel: this.translate.instant('HOSTED_SERVER.REVOKE_DEVICE'),
            tone: 'destructive',
            onConfirm: () => void this.revoke(device.id),
        });
    }

    savePassword(event: Event, input: HTMLInputElement): void {
        event.preventDefault();
        event.stopPropagation();
        const password = input.value;
        input.value = '';
        if (
            password.length >= this.passwordMinLength &&
            password.length <= this.passwordMaxLength
        ) {
            void this.updatePassword(password);
        }
    }

    confirmClearPassword(): void {
        void this.dialog.openConfirmDialog({
            title: this.translate.instant('HOSTED_SERVER.PHONE_PASSWORD_CLEAR'),
            subtitle: this.translate.instant(
                'HOSTED_SERVER.PHONE_PASSWORD_LABEL'
            ),
            message: this.translate.instant(
                'HOSTED_SERVER.PHONE_PASSWORD_CLEAR_CONFIRM'
            ),
            confirmLabel: this.translate.instant(
                'HOSTED_SERVER.PHONE_PASSWORD_CLEAR'
            ),
            tone: 'destructive',
            onConfirm: () => void this.updatePassword(null),
        });
    }

    private async updatePassword(password: string | null): Promise<void> {
        const origin = this.httpsOrigin();
        if (!origin || this.passwordBusy() || this.destroyRef.destroyed) return;
        this.passwordBusy.set(true);
        this.passwordNotice.set(null);
        try {
            await this.request({ action: 'set-browser-password', password });
            if (this.destroyRef.destroyed || this.httpsOrigin() !== origin)
                return;
            this.passwordSettings.set({
                passwordConfigured: password !== null,
            });
            this.passwordNotice.set({
                key:
                    password === null
                        ? 'HOSTED_SERVER.PHONE_PASSWORD_CLEARED'
                        : 'HOSTED_SERVER.PHONE_PASSWORD_SAVED',
            });
        } catch {
            if (this.httpsOrigin() === origin) {
                this.passwordNotice.set({
                    key: 'HOSTED_SERVER.PHONE_PASSWORD_UPDATE_FAILED',
                    error: true,
                });
            }
        } finally {
            this.passwordBusy.set(false);
        }
    }

    private async revoke(deviceId: string): Promise<void> {
        await this.run(async () => {
            await this.request({ action: 'revoke', deviceId });
            this.message.set('HOSTED_SERVER.DEVICE_REVOKED');
        });
    }

    private async run(operation: () => Promise<void>): Promise<void> {
        if (this.busy() || this.destroyRef.destroyed) return;
        this.busy.set(true);
        this.message.set('');
        try {
            await operation();
        } catch {
            this.message.set('HOSTED_SERVER.DEVICE_ACTION_FAILED');
        } finally {
            this.busy.set(false);
            if (this.expanded()) void this.readDevices();
        }
    }

    private async readDevices(): Promise<void> {
        if (this.loading || this.destroyRef.destroyed) return;
        this.loading = true;
        try {
            const invite = this.invite();
            const fragment = invite ? new URL(invite.url).hash : '';
            const inviteId = this.cloudflare()
                ? new URLSearchParams(fragment.slice(1)).get('invite') ?? undefined
                : undefined;
            const snapshot = await this.request({ action: 'list', ...(inviteId ? { inviteId } : {}) });
            if (this.destroyRef.destroyed) return;
            if (
                invite && this.invite() === invite &&
                ((inviteId && snapshot.inviteActive === false) ||
                    snapshot.pending.some(({ inviteId }) => fragment === `#${inviteId}`))
            ) {
                this.invite.set(null);
                if (this.message() === 'HOSTED_SERVER.PAIR_LINK_COPIED') this.message.set('');
            }
            this.list.set(snapshot);
            this.listFailed.set(false);
        } catch {
            this.listFailed.set(true);
        } finally {
            this.loading = false;
        }
    }

    private async request<Command extends HostedDeviceCommand>(
        command: Command
    ): Promise<HostedDeviceResults[Command['action']]> {
        const electron = window.electron;
        if (!electron?.hostedDeviceControl)
            throw new Error('Device pairing unavailable');
        return electron.hostedDeviceControl(command);
    }
}
