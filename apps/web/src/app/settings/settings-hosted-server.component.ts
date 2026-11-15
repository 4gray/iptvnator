import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Clipboard } from '@angular/cdk/clipboard';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import { timer } from 'rxjs';
import {
    parseHostedHttpsOrigin,
    type HostedCloudflareStatus,
    type HostedServerMode,
    type HostedServerCommand,
    type HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { SERVER_GUIDES } from './settings-server-about-dialog.component';
import { SettingsHostedDevicesComponent } from './settings-hosted-devices.component';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';

type Mode = Exclude<HostedServerMode['mode'], 'proxy'>;

const ACCESS_MODE_LABELS = {
    lan: 'HOSTED_SERVER.HOME_NETWORK',
    https: 'HOSTED_SERVER.CUSTOM_HTTPS',
    cloudflare: 'HOSTED_SERVER.TUNNEL',
} satisfies Record<Mode, string>;

type ServerDraft = {
    address: string;
    openLan: boolean;
    origin: string;
    certificate: string;
    key: string;
    team: string;
    audience: string;
    managed: boolean;
    token: string;
};

@Injectable({ providedIn: 'root' })
class HostedServerDrafts {
    mode?: Mode;
    readonly values = new Map<Mode, ServerDraft>();
}

@Component({
    selector: 'app-settings-hosted-server',
    providers: [provideFormFieldDefaults()],
    imports: [
        SettingsHostedDevicesComponent,
        SettingsSyncStatusComponent,
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
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
    readonly status = signal<HostedServerStatus>({ state: 'unavailable' });
    readonly connector = signal<HostedCloudflareStatus | undefined>(undefined);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly feedback = signal('');
    readonly mode = signal<Mode>('lan');
    readonly address = signal('');
    readonly lanShareAddress = signal('');
    readonly openLan = signal(false);
    readonly origin = signal('');
    readonly certificate = signal('');
    readonly key = signal('');
    readonly team = signal('');
    readonly audience = signal('');
    readonly managed = signal(false);
    readonly token = signal('');
    readonly endpoint = computed(
        () =>
            this.status().endpoint ??
            this.status().lanUrl ??
            this.status().httpsOrigin
    );
    readonly accessModeLabel = computed(() => {
        if (!this.endpoint()) return 'HOSTED_SERVER.PC_ONLY';
        const status = this.status();
        const mode = status.mode;
        return ACCESS_MODE_LABELS[
            mode && mode !== 'proxy' ? mode : status.httpsOrigin ? 'https' : 'lan'
        ];
    });
    readonly canPair = computed(
        () =>
            !!this.endpoint() &&
            (this.status().mode !== 'cloudflare' ||
                this.status().publicRoute === 'access-protected')
    );
    readonly pairingUnavailableReason = computed(() => {
        const { mode, publicRoute } = this.status();
        return mode === 'cloudflare' && !this.canPair()
            ? `HOSTED_SERVER.ROUTE_${publicRoute ?? 'unchecked'}`
            : undefined;
    });
    readonly canShareOnLan = computed(
        () =>
            this.status().state === 'running' &&
            !this.busy() &&
            !this.endpoint() &&
            !!this.status().availableAddresses?.includes(this.lanShareAddress())
    );
    readonly canSubmit = computed(
        () =>
            !this.busy() &&
            (this.mode() === 'lan'
                ? !this.openLan() || !!this.address()
                : !!this.origin().trim() &&
                  (this.mode() !== 'https' ||
                      (!!this.certificate().trim() && !!this.key().trim())) &&
                  (this.mode() !== 'cloudflare' ||
                      (!!this.team().trim() &&
                          !!this.audience().trim() &&
                          (!this.managed() ||
                              (this.connector()?.secureStorage &&
                                  (!!this.token().trim() ||
                                      this.connector()?.savedToken))))))
    );

    private readonly clipboard = inject(Clipboard);
    private readonly destroyRef = inject(DestroyRef);
    private readonly drafts = inject(HostedServerDrafts);
    private initialized = false;
    private reading = false;
    private revision = 0;

    constructor() {
        this.destroyRef.onDestroy(() => {
            if (this.initialized) this.rememberDraft();
        });
        timer(0, 3000)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                if (!this.busy()) void this.readStatus();
            });
    }

    selectMode(mode: Mode): void {
        if (mode === this.mode()) return;
        this.rememberDraft();
        this.showMode(mode, this.status());
    }

    async start(): Promise<void> {
        if (!this.canSubmit()) return;
        const mode = this.mode();
        const address = this.address();
        let configuration: HostedServerMode;
        try {
            if (mode === 'lan') {
                configuration = {
                    mode,
                    address,
                    access: this.openLan() ? 'open' : 'paired',
                };
            } else {
                const origin = parseHostedHttpsOrigin(
                    this.origin().trim()
                ).origin;
                const certificatePath = this.certificate().trim();
                const keyPath = this.key().trim();
                configuration =
                    mode === 'cloudflare'
                        ? {
                              mode,
                              origin,
                              certificatePath,
                              keyPath,
                              team: this.team().trim(),
                              audience: this.audience().trim(),
                              managed: this.managed(),
                          }
                        : { mode, origin, address, certificatePath, keyPath };
            }
        } catch {
            this.error.set('HOSTED_SERVER.HTTPS_INVALID');
            return;
        }
        const connectorToken =
            mode === 'cloudflare' && this.managed() ? this.token().trim() : '';
        if (mode === 'cloudflare') this.token.set('');
        await this.control({
            start: true,
            configuration,
            ...(connectorToken ? { connectorToken } : {}),
        });
    }

    async stop(): Promise<void> {
        await this.control('stop');
    }

    async shareOnLan(): Promise<void> {
        if (!this.canShareOnLan()) return;

        const address = this.lanShareAddress();
        this.selectMode('lan');
        this.address.set(address);
        this.openLan.set(false);
        await this.start();
        if (this.endpoint()) this.lanShareAddress.set('');
    }

    async forgetToken(): Promise<void> {
        if (this.busy() || this.status().state === 'running') return;
        this.busy.set(true);
        this.revision++;
        try {
            this.connector.set(
                await window.electron.hostedCloudflareControl!('forget')
            );
            this.token.set('');
        } catch {
            this.error.set('HOSTED_SERVER.CLOUDFLARE_FORGET_FAILED');
        } finally {
            this.busy.set(false);
        }
    }

    copyAddress(address: string): void {
        this.feedback.set(
            this.clipboard.copy(address)
                ? 'HOSTED_SERVER.ADDRESS_COPIED'
                : 'HOSTED_SERVER.COPY_FAILED'
        );
    }

    selectPemFile(input: HTMLInputElement, field: 'certificate' | 'key'): void {
        const file = input.files?.[0];
        input.value = '';
        if (!file || this.busy() || this.mode() !== 'https') return;
        const path = window.electron.getPathForFile?.(file);
        if (path) this[field].set(path);
    }

    private async readStatus(): Promise<void> {
        if (this.reading) return;
        this.reading = true;
        const revision = this.revision;
        try {
            const [status, connector] = await Promise.all([
                window.electron.hostedServerControl!('status'),
                window.electron
                    .hostedCloudflareControl?.('status')
                    .catch(() => undefined),
            ]);
            if (revision !== this.revision || this.destroyRef.destroyed) return;
            this.status.set(status);
            this.connector.set(connector);
            if (!this.initialized) {
                this.initialized = true;
                const savedMode = status.configuration?.mode;
                const supportedMode = savedMode === 'proxy'
                    ? status.savedConfigurations?.https ? 'https' : 'lan'
                    : savedMode ?? 'lan';
                this.showMode(this.drafts.mode ?? supportedMode, status);
            }
        } catch {
            if (revision === this.revision)
                this.error.set('HOSTED_SERVER.ERROR_startup');
        } finally {
            this.reading = false;
        }
    }

    private rememberDraft(): void {
        const mode = this.mode();
        this.drafts.mode = mode;
        this.drafts.values.set(mode, {
            address: this.address(),
            openLan: this.openLan(),
            origin: this.origin(),
            certificate: this.certificate(),
            key: this.key(),
            team: this.team(),
            audience: this.audience(),
            managed: this.managed(),
            token: this.token(),
        });
    }

    private showMode(mode: Mode, status: HostedServerStatus): void {
        const config = status.configuration?.mode === mode
            ? status.configuration
            : status.savedConfigurations?.[mode];
        const draft = this.drafts.values.get(mode);
        const tls = config && config.mode !== 'lan' ? config : undefined;
        const tunnel = config?.mode === 'cloudflare' ? config : undefined;
        this.mode.set(mode);
        const defaultAddress = mode === 'lan'
            ? status.lanAddress ?? status.availableAddresses?.[0] ?? ''
            : '';
        this.address.set(draft?.address ?? (config && 'address' in config
            ? config.address
            : defaultAddress));
        this.openLan.set(draft?.openLan ?? (config?.mode === 'lan' && config.access === 'open'));
        this.origin.set(draft?.origin ?? tls?.origin ?? '');
        this.certificate.set(draft?.certificate ?? tls?.certificatePath ?? '');
        this.key.set(draft?.key ?? tls?.keyPath ?? '');
        this.team.set(draft?.team ?? tunnel?.team ?? '');
        this.audience.set(draft?.audience ?? tunnel?.audience ?? '');
        this.managed.set(draft?.managed ?? tunnel?.managed ?? false);
        this.token.set(draft?.token ?? '');
        this.drafts.values.delete(mode);
    }

    private async control(
        command: Exclude<HostedServerCommand, 'status'>
    ): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.revision++;
        this.error.set('');
        this.feedback.set('');
        try {
            this.status.set(
                await window.electron.hostedServerControl!(command)
            );
        } catch {
            this.error.set('HOSTED_SERVER.MODE_INVALID');
        } finally {
            this.busy.set(false);
            void this.readStatus();
        }
    }
}
