import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import { requestSourceServer } from '@iptvnator/services/source-sync';
import {
    CONNECTION_KEY,
    sourceConnection,
} from '@iptvnator/services/source-sync/connection';
import {
    TMDB_TRANSFER_CODE_LENGTH,
    isTmdbTransferCapability,
    isTmdbTransferCode,
    isTmdbTransferKey,
    type TmdbTransferRequest,
    type TmdbTransferSession,
} from '@iptvnator/shared/interfaces';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { SettingsTmdbTransferStorage } from './settings-tmdb-transfer-storage';

type Stage = 'choose' | 'send' | 'waiting' | 'ready' | 'sent' | 'closed';

@Component({
    imports: [
        ClipboardModule,
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    providers: [provideFormFieldDefaults(), SettingsTmdbTransferStorage],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './settings-tmdb-transfer-dialog.component.html',
    styleUrl: './settings-tmdb-transfer-dialog.component.scss',
})
export class SettingsTmdbTransferDialogComponent {
    private readonly settings = inject(SettingsTmdbTransferStorage);
    private readonly dialog =
        inject<MatDialogRef<SettingsTmdbTransferDialogComponent, boolean>>(
            MatDialogRef
        );
    private readonly destroyRef = inject(DestroyRef);
    private readonly connection = sourceConnection();

    readonly server = this.connection?.apiUrl;
    readonly stage = signal<Stage>('choose');
    readonly busy = signal(false);
    readonly error = signal('');
    readonly sendCode = signal('');
    readonly codeCharacters = computed(() =>
        isTmdbTransferCode(this.sendCode()) ? [...this.sendCode()] : []
    );
    readonly copied = signal(false);
    readonly codeInput = new FormControl('', { nonNullable: true });
    readonly replacing = signal(false);

    private session?: TmdbTransferSession;
    private expectedKey = '';
    private receivedKey?: string;
    private deadline = 0;
    private pollTimer?: ReturnType<typeof setTimeout>;
    private expiryTimer?: ReturnType<typeof setTimeout>;

    constructor() {
        this.dialog.beforeClosed().subscribe(() => this.clearSession());
        this.destroyRef.onDestroy(() => this.clearSession());
    }

    async start(): Promise<void> {
        await this.run(async () => {
            const expectedKey = await this.settings.readSavedTmdbKey();
            const startedAt = performance.now();
            const { senderToken, receiverToken, expiresInMs } =
                await this.request({ action: 'start', codeFormat: 'short' });
            if (
                (!isTmdbTransferCode(senderToken) &&
                    !isTmdbTransferCapability(senderToken)) ||
                !isTmdbTransferCapability(receiverToken) ||
                typeof expiresInMs !== 'number' ||
                !Number.isFinite(expiresInMs) ||
                expiresInMs <= 0 ||
                expiresInMs > 300_000
            )
                throw new Error('Invalid transfer response');

            this.session = { senderToken, receiverToken, expiresInMs };
            this.deadline = startedAt + expiresInMs;
            this.expectedKey = expectedKey;
            this.replacing.set(!!expectedKey);
            this.sendCode.set(senderToken);
            this.stage.set('waiting');
            this.expiryTimer = setTimeout(
                () => this.closeSession('CLOSED'),
                this.deadline - performance.now()
            );
            this.schedulePoll();
        });
    }

    async send(): Promise<void> {
        await this.run(async () => {
            const input = this.codeInput.value.trim();
            const transferToken =
                input.length === TMDB_TRANSFER_CODE_LENGTH
                    ? input.toUpperCase()
                    : input;
            if (
                !isTmdbTransferCode(transferToken) &&
                !isTmdbTransferCapability(transferToken)
            ) {
                this.error.set('INVALID_CODE');
                return;
            }
            const state = await this.request({
                action: 'check',
                transferToken,
            });
            if (state.status === 'ready') {
                this.error.set('USED');
                return;
            }
            if (state.status !== 'waiting')
                throw new Error('Invalid transfer response');
            const apiKey = await this.settings.readSavedTmdbKey();
            if (!isTmdbTransferKey(apiKey)) {
                this.error.set('NO_KEY');
                return;
            }
            const sent = await this.request({
                action: 'send',
                transferToken,
                apiKey,
            });
            if (sent.status !== 'ready')
                throw new Error('Invalid transfer response');
            this.codeInput.reset();
            this.stage.set('sent');
        });
    }

    async save(): Promise<void> {
        const session = this.session;
        if (!session) return;
        await this.run(async () => {
            if (!this.canSave(session)) {
                this.closeSession('CLOSED');
                return;
            }
            if (!this.receivedKey) {
                const { apiKey } = await this.request({
                    action: 'claim',
                    transferToken: session.receiverToken,
                });
                if (!this.canSave(session)) {
                    this.closeSession('CLOSED');
                    return;
                }
                if (!isTmdbTransferKey(apiKey))
                    throw new Error('Invalid transfer response');
                this.receivedKey = apiKey;
            }
            try {
                const saved = await this.settings.saveTransferredTmdbKey(
                    this.receivedKey,
                    this.expectedKey,
                    () => this.canSave(session)
                );
                if (!saved) {
                    this.closeSession(
                        this.canSave(session) ? 'KEY_CHANGED' : 'CLOSED'
                    );
                    return;
                }
            } catch {
                if (this.session === session) this.error.set('SAVE_FAILED');
                return;
            }
            this.dialog.close(true);
        });
    }

    private async run(work: () => Promise<void>): Promise<void> {
        if (this.busy()) return;
        this.error.set('');
        this.busy.set(true);
        this.dialog.disableClose = true;
        try {
            await work();
        } catch (error) {
            const status = error instanceof TransferFailure ? error.status : 0;
            if (status === 410 && this.session) this.closeSession('CLOSED');
            else if (this.stage() !== 'closed')
                this.error.set(
                    status === 410
                        ? 'CLOSED'
                        : status === 404
                          ? 'UNSUPPORTED'
                          : status === 429
                            ? 'BUSY'
                            : status === 409
                              ? 'USED'
                              : 'UNAVAILABLE'
                );
        } finally {
            this.busy.set(false);
            this.dialog.disableClose = false;
        }
    }

    private async request(request: TmdbTransferRequest) {
        const connection = this.connection;
        if (!connection || !this.isCurrent()) throw new TransferFailure(410);
        const response = await requestSourceServer({
            operation: 'tmdb-transfer',
            tmdbTransfer: { connection, request },
        });
        if (!this.isCurrent()) throw new TransferFailure(410);
        if (response.status < 200 || response.status >= 300) {
            const body = response.body as { code?: string } | undefined;
            throw new TransferFailure(
                body?.code === 'instance_changed' ? 410 : response.status
            );
        }
        return response.body as Record<string, unknown>;
    }

    private schedulePoll(): void {
        this.pollTimer = setTimeout(() => void this.poll(), 1500);
    }

    private async poll(): Promise<void> {
        const session = this.session;
        if (!session) return;
        if (!this.canSave(session)) {
            this.closeSession('CLOSED');
            return;
        }
        try {
            const state = await this.request({
                action: 'status',
                transferToken: session.receiverToken,
            });
            if (this.session !== session) return;
            this.error.set('');
            if (state.status === 'ready') {
                this.sendCode.set('');
                this.stage.set('ready');
                return;
            }
        } catch (error) {
            if (this.session !== session) return;
            if (
                error instanceof TransferFailure &&
                [401, 403, 409, 410].includes(error.status)
            ) {
                this.closeSession('CLOSED');
                return;
            }
            this.error.set('UNAVAILABLE');
        }
        this.schedulePoll();
    }

    private canSave(session: TmdbTransferSession): boolean {
        return (
            this.session === session &&
            performance.now() < this.deadline &&
            this.isCurrent()
        );
    }

    private isCurrent(): boolean {
        if (
            this.destroyRef.destroyed ||
            !this.connection ||
            this.connection !== sourceConnection()
        )
            return false;
        try {
            const current = window.electron?.sourceSyncConnection
                ? window.electron.sourceSyncConnection()
                : JSON.parse(localStorage.getItem(CONNECTION_KEY) ?? 'null');
            return (
                current?.apiUrl === this.connection.apiUrl &&
                current?.instanceId === this.connection.instanceId
            );
        } catch {
            return false;
        }
    }

    private closeSession(error: string): void {
        this.clearSession();
        this.error.set(error);
        this.stage.set('closed');
    }

    private clearSession(): void {
        clearTimeout(this.pollTimer);
        clearTimeout(this.expiryTimer);
        const session = this.session;
        const claimed = !!this.receivedKey;
        this.session = undefined;
        this.expectedKey = '';
        this.receivedKey = undefined;
        this.sendCode.set('');
        if (session && !claimed)
            void this.request({
                action: 'cancel',
                transferToken: session.receiverToken,
            }).catch(() => undefined);
    }
}

class TransferFailure extends Error {
    constructor(readonly status: number) {
        super('TMDB key transfer failed');
    }
}
