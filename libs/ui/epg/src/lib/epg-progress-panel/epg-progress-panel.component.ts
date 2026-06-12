import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    EpgImportProgress,
    EpgProgressService,
} from '@iptvnator/epg/data-access';
import { ELECTRON_BRIDGE_SECURITY_ERROR_CODES } from '@iptvnator/shared/interfaces';

interface EpgTrustConfirmDialogData {
    confirmLabel: string;
    message: string;
    title: string;
}

@Component({
    selector: 'app-epg-trust-confirm-dialog',
    imports: [MatButtonModule, MatDialogModule, TranslatePipe],
    template: `
        <h2 mat-dialog-title>{{ data.title }}</h2>
        <mat-dialog-content class="mat-typography">
            {{ data.message }}
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close cdkFocusInitial>
                {{ 'CANCEL' | translate }}
            </button>
            <button mat-flat-button color="primary" [mat-dialog-close]="true">
                {{ data.confirmLabel }}
            </button>
        </mat-dialog-actions>
    `,
})
class EpgTrustConfirmDialogComponent {
    readonly data = inject<EpgTrustConfirmDialogData>(MAT_DIALOG_DATA);
}

@Component({
    selector: 'app-epg-progress-panel',
    standalone: true,
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatTooltip,
        MatProgressBar,
        TranslatePipe,
    ],
    templateUrl: './epg-progress-panel.component.html',
    styleUrl: './epg-progress-panel.component.scss',
})
export class EpgProgressPanelComponent {
    private readonly epgProgress = inject(EpgProgressService);
    private readonly dialog = inject(MatDialog);
    private readonly translate = inject(TranslateService);

    readonly imports = this.epgProgress.imports;
    readonly isVisible = this.epgProgress.isVisible;
    readonly queuedCount = this.epgProgress.queuedCount;
    readonly activeCount = this.epgProgress.activeCount;
    readonly minimized = signal(false);

    readonly loadingCount = computed(
        () => this.imports().filter((i) => i.status === 'loading').length
    );

    toggleMinimize(): void {
        this.minimized.update((v) => !v);
    }

    get activeImports() {
        return this.imports().filter((item) => item.status !== 'queued');
    }

    get queuedImports() {
        return this.imports()
            .filter((item) => item.status === 'queued')
            .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
    }

    getStatusIcon(status: EpgImportProgress['status']): string {
        switch (status) {
            case 'queued':
                return 'schedule';
            case 'loading':
                return 'sync';
            case 'complete':
                return 'check_circle';
            case 'error':
                return 'error';
        }
    }

    getStatusClass(status: EpgImportProgress['status']): string {
        return `status-${status}`;
    }

    getDisplayUrl(url: string): string {
        try {
            const urlObject = new URL(url);
            return urlObject.hostname + urlObject.pathname.split('/').pop();
        } catch {
            return url.length > 40 ? `${url.substring(0, 40)}...` : url;
        }
    }

    dismiss(url: string): void {
        this.epgProgress.dismiss(url);
    }

    dismissAll(): void {
        this.epgProgress.dismissAll();
    }

    retry(url: string): void {
        this.epgProgress.retry(url);
    }

    isActionableSecurityError(item: EpgImportProgress): boolean {
        return (
            item.errorCode ===
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked ||
            item.errorCode ===
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate
        );
    }

    getActionLabel(item: EpgImportProgress): string {
        if (
            item.errorCode ===
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked
        ) {
            return this.translateWithFallback(
                'EPG.ALLOW_PRIVATE_SOURCE',
                'Allow source'
            );
        }

        return this.translateWithFallback('EPG.TRUST_TLS_HOST', 'Trust host');
    }

    confirmTrust(item: EpgImportProgress): void {
        if (
            item.errorCode ===
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked
        ) {
            this.openTrustDialog(
                {
                    title: this.translateWithFallback(
                        'EPG.ALLOW_PRIVATE_SOURCE_TITLE',
                        'Allow private-network EPG source?'
                    ),
                    message: this.translateWithFallback(
                        'EPG.ALLOW_PRIVATE_SOURCE_WARNING',
                        'Only allow this if you trust the EPG source. IPTVnator will let this exact EPG URL connect to private or local network addresses.'
                    ),
                    confirmLabel: this.translateWithFallback(
                        'EPG.ALLOW_PRIVATE_SOURCE',
                        'Allow source'
                    ),
                },
                () => {
                    void this.epgProgress.trustPrivateNetworkSourceAndRetry(
                        item.url
                    );
                }
            );
            return;
        }

        this.openTrustDialog(
            {
                title: this.translateWithFallback(
                    'EPG.TRUST_TLS_HOST_TITLE',
                    'Trust invalid certificate?'
                ),
                message: this.translateWithFallback(
                    'EPG.TRUST_TLS_HOST_WARNING',
                    'Only continue if you trust this host. IPTVnator will allow invalid TLS certificates for this host, but other hosts still require valid certificates.'
                ),
                confirmLabel: this.translateWithFallback(
                    'EPG.TRUST_TLS_HOST',
                    'Trust host'
                ),
            },
            () => {
                void this.epgProgress.trustInsecureTlsHostAndRetry(
                    item.url,
                    item.errorHost
                );
            }
        );
    }

    private openTrustDialog(
        data: EpgTrustConfirmDialogData,
        onConfirm: () => void
    ): void {
        this.dialog
            .open<EpgTrustConfirmDialogComponent, EpgTrustConfirmDialogData>(
                EpgTrustConfirmDialogComponent,
                { data, width: '420px' }
            )
            .afterClosed()
            .subscribe((confirmed) => {
                if (confirmed) {
                    onConfirm();
                }
            });
    }

    private translateWithFallback(key: string, fallback: string): string {
        const translated = this.translate.instant(key);
        return translated === key ? fallback : translated;
    }
}
