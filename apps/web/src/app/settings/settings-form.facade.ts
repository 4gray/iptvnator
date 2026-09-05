import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder } from '@angular/forms';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    CoverSize,
    EpgViewMode,
    Language,
    Theme,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { SettingsSnackbarService } from './settings-snackbar.service';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import {
    applyEpgUrlsToFormArray,
    createEpgUrlControl,
    createSettingsForm,
    createSettingsFromFormValue,
    SettingsForm,
} from './settings-form.utils';

type SettingsFormPatch = Parameters<SettingsForm['patchValue']>[0];

/**
 * Owns the settings form: creation, hydration from the store, the small
 * mutations the section components trigger, and persisting on submit.
 */
@Injectable()
export class SettingsFormFacade {
    private readonly destroyRef = inject(DestroyRef);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly formBuilder = inject(FormBuilder);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsService = inject(SettingsService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly translate = inject(TranslateService);

    readonly supportsEpg =
        this.epgBridge.supportsImport && this.epgBridge.supportsDataManagement;

    /** Settings form object */
    readonly form = createSettingsForm(this.formBuilder, this.supportsEpg);

    /** Form array with epg sources — absent when EPG is unsupported */
    readonly epgUrl = this.form.get('epgUrl') as FormArray;

    /** Trimmed, non-empty EPG source URLs currently in the form */
    get epgUrls(): string[] {
        return ((this.epgUrl?.value as string[] | undefined) ?? [])
            .map((url) => url?.trim())
            .filter((url): url is string => Boolean(url));
    }

    /** Waits for the persisted settings to be available */
    async loadSettings(): Promise<void> {
        await this.settingsStore.loadSettings();

        if (this.settingsStore.storageFailure() === 'load') {
            // The form is about to show defaults that are not the user's saved
            // values — say so instead of letting them look genuine.
            this.settingsSnackbar.storageFailure('load');
        }
    }

    /**
     * Sets saved settings from the indexed db store
     */
    hydrateFromStore(): void {
        const currentSettings = this.settingsStore.getSettings();
        this.form.patchValue(currentSettings);
        this.syncDashboardControlsEnabledState(
            currentSettings.showDashboard ?? true
        );

        if (this.supportsEpg && currentSettings.epgUrl) {
            this.epgUrl.clear();
            this.setEpgUrls(currentSettings.epgUrl);
        }
    }

    bindDashboardControlsEnabledState(): void {
        this.form
            .get('showDashboard')
            ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((showDashboard) =>
                this.syncDashboardControlsEnabledState(showDashboard ?? true)
            );
    }

    selectTheme(theme: Theme): void {
        if (this.form.value.theme === theme) {
            return;
        }

        this.patchAndMarkDirty({ theme }, 'theme');
        this.settingsService.changeTheme(theme);
    }

    /**
     * Staged like every other control — the write happens on Save. These two
     * used to persist eagerly, which made Discard a lie: `hydrateFromStore()`
     * would faithfully reload the just-persisted edit and the unsaved bar
     * disappeared without anything being reverted.
     */
    selectCoverSize(coverSize: CoverSize): void {
        if (this.form.value.coverSize === coverSize) {
            return;
        }

        this.patchAndMarkDirty({ coverSize }, 'coverSize');
    }

    selectEpgViewMode(epgViewMode: EpgViewMode): void {
        if (this.form.value.epgViewMode === epgViewMode) {
            return;
        }

        this.patchAndMarkDirty({ epgViewMode }, 'epgViewMode');
    }

    setRecordingFolder(recordingFolder: string): void {
        this.patchAndMarkDirty({ recordingFolder }, 'recordingFolder');
    }

    /**
     * Sets the epg urls to the form array
     * @param epgUrls urls of the EPG sources
     */
    setEpgUrls(epgUrls: string[] | string): void {
        applyEpgUrlsToFormArray(this.epgUrl, epgUrls);
    }

    /**
     * Initializes new entry in form array for EPG URL
     */
    addEpgSource(): void {
        this.epgUrl.insert(this.epgUrl.length, createEpgUrlControl());
    }

    /**
     * Removes entry from form array for EPG URL
     * @param index index of the item to remove
     */
    removeEpgSource(index: number): void {
        this.epgUrl.removeAt(index);
        this.epgUrl.markAsDirty();
        this.form.markAsDirty();
    }

    /**
     * Persists the form to the settings store and mirrors the result to the
     * desktop backend.
     * @param onSaved runs after the store write, before the backend is
     * notified, so the UI confirmation is not delayed by IPC
     */
    async save(onSaved: () => void): Promise<void> {
        const settings = createSettingsFromFormValue(
            this.form,
            this.settingsStore.getSettings()
        );

        await this.settingsStore.updateSettings(settings, {
            retryEpgCleanup: this.epgUrl?.dirty ?? false,
        });
        onSaved();

        if (!window.electron) {
            return;
        }

        window.electron.updateSettings(settings);

        if (this.runtime.supportsExternalPlayerPathSettings) {
            window.electron.setMpvPlayerPath(settings.mpvPlayerPath);
            window.electron.setVlcPlayerPath(settings.vlcPlayerPath);
        }
    }

    /** Applies the saved language/theme and resets the dirty state */
    applySavedSettings(): void {
        this.form.markAsPristine();
        this.translate.use(this.form.value.language ?? Language.ENGLISH);
        this.settingsService.changeTheme(
            this.form.value.theme ?? Theme.SystemTheme
        );
    }

    private patchAndMarkDirty(
        value: SettingsFormPatch,
        controlName: string
    ): void {
        this.form.patchValue(value);
        this.form.get(controlName)?.markAsDirty();
        this.form.markAsDirty();
    }

    private syncDashboardControlsEnabledState(showDashboard: boolean): void {
        const dashboardRails = this.form.get('dashboardRails');
        if (!dashboardRails) {
            return;
        }

        if (showDashboard) {
            dashboardRails.enable({ emitEvent: false });
        } else {
            dashboardRails.disable({ emitEvent: false });
        }
    }
}
