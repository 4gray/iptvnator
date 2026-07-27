import { inject, Injectable, signal } from '@angular/core';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import { DialogService } from '@iptvnator/ui/components';
import { TranslateService } from '@ngx-translate/core';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsFormFacade } from './settings-form.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';

/**
 * EPG maintenance actions offered by the settings page: force refreshes and
 * the destructive "clear all EPG data" flow.
 */
@Injectable()
export class SettingsEpgFacade {
    private readonly dialogService = inject(DialogService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly epgService = inject(EpgService);
    private readonly formFacade = inject(SettingsFormFacade);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly translate = inject(TranslateService);

    readonly isClearing = signal(false);

    /**
     * Force-fetch EPG for a single URL, bypassing the 12-hour freshness check.
     * The plain fetchEpg would short-circuit on fresh data and click the
     * refresh button would be a no-op — that's exactly not what the user
     * intends when clicking "Refresh".
     */
    refresh(url: string): void {
        if (!this.epgBridge.supportsDataManagement || !url) {
            return;
        }
        void this.epgBridge.forceFetchEpg(
            url,
            this.settingsStore.getTrustOptions()
        );
    }

    /**
     * Force-fetch every configured EPG URL sequentially. Empty fields are
     * skipped. Each URL flows through the normal progress panel so the user
     * gets visible per-URL feedback.
     */
    refreshAll(): void {
        if (!this.epgBridge.supportsDataManagement) return;
        const options = this.settingsStore.getTrustOptions();
        this.formFacade.epgUrls.forEach(
            (url) => void this.epgBridge.forceFetchEpg(url, options)
        );
    }

    /**
     * Clears all EPG data from database and immediately re-fetches every
     * configured URL so the user isn't left staring at an empty state.
     * Tracks progress with `isClearing` so the UI can show a spinner
     * and block double-clicks, and surfaces failures via a dedicated snackbar.
     */
    clear(): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('SETTINGS.CLEAR_EPG_DIALOG.TITLE'),
            message: this.translate.instant(
                'SETTINGS.CLEAR_EPG_DIALOG.MESSAGE'
            ),
            onConfirm: async (): Promise<void> => {
                if (
                    !this.epgBridge.supportsDataManagement ||
                    this.isClearing()
                ) {
                    return;
                }

                this.isClearing.set(true);
                try {
                    const result = await this.epgBridge.clearEpgData();
                    if (result && result.success === false) {
                        throw new Error('Clear EPG returned success=false');
                    }
                    this.settingsSnackbar.open(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEARED')
                    );
                    this.refreshAll();
                } catch (error) {
                    console.error('Failed to clear EPG data:', error);
                    this.settingsSnackbar.open(
                        this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED')
                    );
                } finally {
                    this.isClearing.set(false);
                }
            },
        });
    }

    /**
     * Re-fetches the EPG sources that were just saved so the guide reflects
     * the new configuration without a restart.
     */
    fetchConfiguredEpg(): void {
        if (!this.formFacade.supportsEpg) {
            return;
        }

        const epgUrl = this.formFacade.form.value.epgUrl;

        if (!epgUrl) {
            return;
        }

        const validEpgUrls = (Array.isArray(epgUrl) ? epgUrl : [epgUrl]).filter(
            (url): url is string => typeof url === 'string' && url !== ''
        );

        if (validEpgUrls.length > 0) {
            // Fetch all EPG URLs at once
            this.epgService.fetchEpg(validEpgUrls);
        }
    }
}
