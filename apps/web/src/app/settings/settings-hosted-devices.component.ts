import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    input,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import type {
    HostedDeviceInvite,
    HostedDeviceList,
} from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { timer } from 'rxjs';

@Component({
    selector: 'app-settings-hosted-devices',
    imports: [MatButtonModule, QRCodeComponent, TranslateModule],
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
    readonly expanded = signal(false);
    readonly invite = signal<HostedDeviceInvite | null>(null);
    readonly inviteExpired = signal(false);
    readonly list = signal<HostedDeviceList | null>(null);
    readonly listFailed = signal(false);
    readonly busy = signal(false);
    readonly message = signal('');

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
                if (this.expanded() && !this.busy()) void this.readDevices();
            });
    }

    toggleDevices(): void {
        this.expanded.update((expanded) => !expanded);
        if (this.expanded()) void this.readDevices();
    }

    async pair(): Promise<void> {
        if (!this.lanAvailable()) return;
        await this.run(async () => {
            this.inviteExpired.set(false);
            this.invite.set(null);
            const invite = await window.electron.hostedDeviceControl!({
                action: 'invite',
            });
            this.invite.set(invite);
            this.expanded.set(true);
        });
    }

    async approve(claimId: string): Promise<void> {
        await this.run(async () => {
            await window.electron.hostedDeviceControl!({
                action: 'approve',
                claimId,
            });
            this.message.set('HOSTED_SERVER.PAIR_APPROVED');
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
            message: this.translate.instant('HOSTED_SERVER.REVOKE_CONFIRM', {
                name: device.name,
            }),
            confirmLabel: this.translate.instant('HOSTED_SERVER.REVOKE_DEVICE'),
            tone: 'destructive',
            onConfirm: () => void this.revoke(device.id),
        });
    }

    private async revoke(deviceId: string): Promise<void> {
        await this.run(async () => {
            await window.electron.hostedDeviceControl!({
                action: 'revoke',
                deviceId,
            });
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
            const snapshot = await window.electron.hostedDeviceControl!({
                action: 'list',
            });
            const invite = this.invite();
            const fragment = invite ? new URL(invite.url).hash : '';
            if (
                snapshot.pending.some(
                    ({ inviteId }) => fragment === `#${inviteId}`
                )
            ) {
                this.invite.set(null);
            }
            this.list.set(snapshot);
            this.listFailed.set(false);
        } catch {
            this.listFailed.set(true);
        } finally {
            this.loading = false;
        }
    }
}
