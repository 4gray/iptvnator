import { SettingsHostedServerComponent } from './settings-hosted-server.component';
import {
    isHostedLibrarySource,
    selectAndroidServer,
} from './android-server-inspection';
import { matchesServerAddress, serverAddressControl } from './server-address';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import {
    disconnectAndroidHostedLibrary,
    getAndroidLibraryControls,
    getAndroidSettingsControls,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { SettingsHistorySectionComponent } from './settings-history-section.component';
import { SettingsFavoritesSectionComponent } from './settings-favorites-section.component';
import {
    ChangeDetectionStrategy,
    DestroyRef,
    Component,
    inject,
    signal,
    viewChild,
    computed,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { dialogSize } from '@iptvnator/ui/dialog/dialog-size';
import {
    SERVER_GUIDES,
    SettingsServerAboutDialogComponent,
} from './settings-server-about-dialog.component';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { SettingsSyncStatusComponent } from './settings-sync-status.component';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { SettingsActivitySectionComponent } from './settings-activity-section.component';
import { createRandomId, type Playlist } from '@iptvnator/shared/interfaces';
import {
    normalizeSourceServerUrl,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import {
    SourceSyncService,
    connectBrowserSourceServer,
    disconnectBrowserSourceConnection,
    forgetSavedBrowserSourceConnection,
    readSavedBrowserSourceConnection,
    readLocalSourcesForImport,
    requestSourceServer,
} from '@iptvnator/services/source-sync';

@Component({
    selector: 'app-settings-server-section',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [provideFormFieldDefaults()],
    imports: [
        NgTemplateOutlet,
        SettingsActivitySectionComponent,
        SettingsHostedServerComponent,
        SettingsFavoritesSectionComponent,
        SettingsHistorySectionComponent,
        SettingsSyncStatusComponent,
        MatIconModule,
        FormsModule,
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        TranslateModule,
    ],
    templateUrl: './settings-server-section.component.html',
    styleUrl: './settings-server-section.component.scss',
})
export class SettingsServerSectionComponent {
    private readonly dialog = inject(MatDialog);
    readonly guides = SERVER_GUIDES;
    readonly sync = inject(SourceSyncService);
    readonly supportsHosting = inject(RuntimeCapabilitiesService)
        .supportsHostedServer;
    protected readonly androidSettings = getAndroidSettingsControls();
    protected readonly androidLibrary = getAndroidLibraryControls();
    protected readonly library = this.androidLibrary?.libraryConnection();
    private readonly destroyRef = inject(DestroyRef);
    private readonly tokenAddress = signal('');
    protected readonly nativeHosted = isHostedLibrarySource(
        this.library?.origin,
        this.sync.connection?.apiUrl
    );
    protected get otherSelectedAddress(): string | undefined {
        const current = this.sync.connection?.apiUrl;
        const origin = this.nativeHosted
            ? this.library?.origin
            : this.library?.savedOrigin;
        if (current && !this.nativeHosted)
            return this.matchesAddress(current) ? undefined : current;
        return origin && !this.matchesAddress(origin + '/api')
            ? origin
            : undefined;
    }
    protected approvalAddress = this.library?.approvalOrigin ?? '';
    protected readonly directSourceConnection = signal(false);
    protected readonly showSourceConnectionForm = computed(() => {
        const connection = this.sync.connection;
        return (
            !!this.library ||
            !this.androidSettings ||
            this.directSourceConnection() ||
            this.sync.connectionReadFailed ||
            this.sync.errorKey() === 'SOURCE_SYNC.INSTANCE_CHANGED' ||
            (!!connection && connection.apiUrl !== `${location.origin}/api`)
        );
    });

    readonly hostedServer = viewChild(SettingsHostedServerComponent);
    readonly localServerUrl = computed(
        () => this.hostedServer()?.status().localUrl
    );

    showAbout(): void {
        this.dialog.open(SettingsServerAboutDialogComponent, dialogSize('md'));
    }

    async connectHosted(url: string): Promise<void> {
        if (this.busy()) return;
        try {
            const code = this.hostedServer()?.status().mode
                ? ''
                : await window.electron.hostedServerAccessCode!();
            this.urlControl.setValue(url);
            this.token = code;
            await this.connect(!!this.hostedServer()?.status().mode);
        } catch {
            this.message.set('HOSTED_SERVER.CODE_FAILED');
        } finally {
            this.token = '';
        }
    }
    readonly busy = signal(false);
    readonly checking = signal(false);
    readonly connecting = signal(false);
    readonly message = signal('');
    readonly preview = signal<Playlist[] | null>(null);
    readonly savedConnection = signal(
        this.sync.connection || this.sync.connectionReadFailed
            ? null
            : window.electron?.sourceSyncConfigure
              ? (window.electron.sourceSyncSavedConnection?.() ?? null)
              : readSavedBrowserSourceConnection()
    );
    readonly urlControl = serverAddressControl(
        (this.nativeHosted
            ? this.library?.origin
            : this.sync.connection?.apiUrl) ??
            this.savedConnection()?.apiUrl ??
            this.library?.savedOrigin ??
            ''
    );
    token = '';

    constructor() {
        if (this.library)
            this.urlControl.valueChanges
                .pipe(takeUntilDestroyed())
                .subscribe(() => {
                    this.tokenAddress.set('');
                    this.token = '';
                    this.message.set('');
                });
    }

    protected needsAndroidToken(): boolean {
        return (
            this.matchesAddress(this.tokenAddress()) ||
            (!this.nativeHosted &&
                (!this.androidLibrary?.connectNasLibrary ||
                    !this.sync.connection?.apiUrl.endsWith('/api')) &&
                this.isCurrentServer() &&
                this.sync.state() === 'locked')
        );
    }

    protected isSavedLibrary(): boolean {
        return (
            !!this.library?.savedOrigin &&
            !this.library.origin &&
            this.matchesAddress(this.library.savedOrigin + '/api')
        );
    }

    protected openHostedPlayer(): void {
        this.urlControl.markAsTouched();
        if (this.urlControl.invalid || this.busy()) return;
        const api = new URL(
            normalizeSourceServerUrl(this.urlControl.value.trim())
        );
        if (api.pathname !== '/api')
            this.message.set('SOURCE_SYNC.URL_INVALID');
        else this.androidLibrary?.connectLibrary(api.origin);
    }

    isCurrentServer(): boolean {
        return (
            !!this.sync.connection &&
            (this.matchesAddress(this.sync.connection.apiUrl) ||
                (this.nativeHosted &&
                    this.matchesAddress(this.library?.origin + '/api')))
        );
    }

    isSavedServer(): boolean {
        return this.matchesAddress(this.savedConnection()?.apiUrl);
    }

    private matchesAddress(apiUrl?: string): boolean {
        return matchesServerAddress(this.urlControl.value, apiUrl);
    }

    async refresh(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.checking.set(true);
        this.message.set('');
        try {
            await this.sync.refresh();
        } catch (error) {
            this.showError(error);
        } finally {
            this.checking.set(false);
            this.busy.set(false);
        }
    }

    async connect(useHosted = false): Promise<void> {
        if (this.busy()) return;
        this.message.set('');
        this.urlControl.markAsTouched();
        if (this.urlControl.invalid) return;
        if (
            this.isCurrentServer() &&
            !this.token &&
            !useHosted &&
            (!this.library ||
                this.sync.state() === 'connected' ||
                (!this.nativeHosted &&
                    !this.androidLibrary?.connectNasLibrary &&
                    this.sync.state() !== 'locked'))
        )
            return this.refresh();
        this.busy.set(true);
        this.connecting.set(true);
        let sourceAddress = '';
        try {
            const input = this.urlControl.value.trim().replace(/\/+$/, '');
            const saved = this.isSavedServer() ? this.savedConnection() : null;
            const reuse = this.token ? null : saved;
            const apiUrl =
                input === this.sync.connection?.apiUrl ||
                input === saved?.apiUrl
                    ? input
                    : normalizeSourceServerUrl(input);
            if (this.androidLibrary) {
                const step = await selectAndroidServer(
                    this.androidLibrary,
                    apiUrl,
                    this.approvalAddress,
                    () =>
                        !this.destroyRef.destroyed &&
                        this.matchesAddress(apiUrl)
                );
                if (step === 'invitation')
                    this.message.set('SETTINGS.ANDROID_ACCESS_INVITE_REQUIRED');
                if (step !== 'sources' && step !== 'token') return;
                sourceAddress = apiUrl;
                if (step === 'token') {
                    this.tokenAddress.set(apiUrl);
                    if (!this.token && !reuse?.hasToken) return;
                }
            }
            if (window.electron?.sourceSyncConfigure) {
                await window.electron.sourceSyncConfigure(
                    apiUrl,
                    this.token,
                    !this.isCurrentServer(),
                    useHosted ? true : reuse?.instanceId
                );
                this.token = '';
                if (this.isCurrentServer()) await this.sync.refresh();
            } else {
                await connectBrowserSourceServer(
                    apiUrl,
                    this.token,
                    this.isCurrentServer()
                        ? this.sync.connection?.instanceId
                        : undefined,
                    reuse
                );
                this.token = '';
                if (this.isCurrentServer()) await this.sync.refresh();
                else location.reload();
            }
        } catch (error) {
            if (
                sourceAddress &&
                this.matchesAddress(sourceAddress) &&
                error instanceof Error &&
                error.message === 'SOURCE_SYNC.LOCKED'
            )
                this.tokenAddress.set(sourceAddress);
            this.showError(error, 'SOURCE_SYNC.CONNECTION_FAILED');
        } finally {
            this.busy.set(false);
            this.connecting.set(false);
        }
    }

    async forgetServer(urlInput: HTMLInputElement | null): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.message.set('');
        try {
            if (window.electron?.sourceSyncForget)
                await window.electron.sourceSyncForget();
            else forgetSavedBrowserSourceConnection();
            if (this.isSavedServer()) {
                this.urlControl.reset('');
                this.token = '';
            }
            this.savedConnection.set(null);
            urlInput?.focus();
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async disconnect(): Promise<void> {
        this.busy.set(true);
        try {
            if (window.electron?.sourceSyncDisconnect)
                await window.electron.sourceSyncDisconnect();
            else {
                if (
                    disconnectAndroidHostedLibrary(this.sync.connection?.apiUrl)
                )
                    return;
                if (!disconnectBrowserSourceConnection())
                    throw new Error('SOURCE_SYNC.REQUEST_FAILED');
                location.reload();
            }
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async previewImport(): Promise<void> {
        this.busy.set(true);
        try {
            this.preview.set(await readLocalSourcesForImport());
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    async importSources(): Promise<void> {
        this.busy.set(true);
        this.message.set('');
        try {
            for (const playlist of this.preview() ?? []) {
                const source = {
                    ...sourceFromPlaylist(playlist),
                    id: createRandomId(),
                };
                const response = await requestSourceServer({
                    operation: 'create',
                    id: source.id,
                    source,
                });
                if (response.status >= 400)
                    throw new Error('SOURCE_SYNC.IMPORT_FAILED');
            }
            await this.sync.refresh();
            this.preview.set(null);
            this.message.set('SOURCE_SYNC.IMPORTED');
        } catch (error) {
            this.showError(error);
        } finally {
            this.busy.set(false);
        }
    }

    private showError(
        error: unknown,
        fallback = 'SOURCE_SYNC.REQUEST_FAILED'
    ): void {
        const key =
            error instanceof Error
                ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                : undefined;
        this.message.set(
            fallback === 'SOURCE_SYNC.CONNECTION_FAILED' &&
                (!key ||
                    key === 'SOURCE_SYNC.OFFLINE' ||
                    key === 'SOURCE_SYNC.REQUEST_FAILED')
                ? fallback
                : (key ?? fallback)
        );
    }
}
