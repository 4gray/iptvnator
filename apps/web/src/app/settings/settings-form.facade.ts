import { normalizeAgeRatingCountry } from '@iptvnator/shared/interfaces/age-rating';
import {
    DestroyRef,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder } from '@angular/forms';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    EpgSourceReconciliationError,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    CoverSize,
    EpgViewMode,
    Language,
    Theme,
} from '@iptvnator/shared/interfaces';
import { SettingsSnackbarService } from './settings-snackbar.service';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import { AppDateLocaleService } from '../app-date-locales';
import {
    diffSettingsValues,
    SETTINGS_RESTART_CONTROLS,
} from './settings-change-tracking';
import { SettingsLaunchValuesService } from './settings-launch-values.service';
import {
    applyEpgUrlsToFormArray,
    createEpgUrlControl,
    createSettingsForm,
    createSettingsFromFormValue,
    SettingsForm,
} from './settings-form.utils';

type SettingsFormPatch = Parameters<SettingsForm['patchValue']>[0];

export class SettingsRuntimeUpdateError extends Error {
    constructor(readonly cause: unknown) {
        super('SETTINGS.SETTINGS_RUNTIME_UPDATE_FAILED');
    }
}

/**
 * Owns the settings form: creation, hydration from the store, the small
 * mutations the section components trigger, and persisting on submit.
 */
@Injectable()
export class SettingsFormFacade {
    private readonly dateLocales = inject(AppDateLocaleService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly formBuilder = inject(FormBuilder);
    private readonly launchValues = inject(SettingsLaunchValuesService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsService = inject(SettingsService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly settingsStore = inject(SettingsStore);

    /** XMLTV sources: the source list, its actions and the Xtream preference. */
    readonly supportsEpg =
        this.epgBridge.supportsImport && this.epgBridge.supportsDataManagement;

    /**
     * The EPG page's display settings (view mode, offset). They shape every
     * guide on screen, so they show wherever one exists: XMLTV, or a
     * portal's own guide (the browser PWA).
     */
    readonly supportsEpgDisplay =
        this.supportsEpg ||
        this.runtime.supportsEpg ||
        this.runtime.supportsProviderEpg;

    /** Settings form object */
    readonly form = createSettingsForm(
        this.formBuilder,
        this.supportsEpg,
        this.supportsEpgDisplay
    );

    /**
     * Form array with epg sources — absent without XMLTV sources (the
     * browser PWA)
     */
    readonly epgUrl = this.form.get('epgUrl') as FormArray;

    /**
     * Dotted paths of the staged values that differ from the saved ones.
     * Drives the save bar's change count and the dirty marks in the nav;
     * the form's own `dirty` flag stays what the save/leave guards read.
     */
    readonly changedPaths = signal<readonly string[]>([]);

    /** Controls whose saved value differs from what the running app uses. */
    readonly restartPendingControls = signal<readonly string[]>([]);

    private savedSnapshot = this.form.getRawValue();
    private saveRevision = 0;

    constructor() {
        this.form.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refreshChangedPaths());
    }

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
        this.form.patchValue({
            ...currentSettings,
            ageRatingCountry: normalizeAgeRatingCountry(
                currentSettings.ageRatingCountry
            ),
        });
        this.syncDashboardControlsEnabledState(
            currentSettings.showDashboard ?? true
        );

        if (this.supportsEpg && currentSettings.epgUrl) {
            this.epgUrl.clear();
            this.setEpgUrls(currentSettings.epgUrl);
        }
        this.takeSavedSnapshot();
        // The app launched with the stored values; recorded once per app run,
        // not per settings visit, so a later visit compares against launch.
        this.launchValues.captureOnce(
            (control) => this.form.get(control)?.value
        );
        this.refreshRestartPending();
    }

    /**
     * What the running app actually uses for a restart control when that
     * differs from the stored value (a frame-copy opt-in the engine could
     * not honour). Re-evaluates the pending notice.
     */
    setRunningValue(control: string, value: unknown): void {
        this.launchValues.set(control, value);
        this.refreshRestartPending();
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
     * @param onSaved runs after persistence and the desktop backend update
     * succeed, so runtime failures keep the form available for retry.
     */
    async save(onSaved: () => void): Promise<void> {
        const saveRevision = ++this.saveRevision;
        const submittedSnapshot = this.form.getRawValue();
        const settings = createSettingsFromFormValue(
            this.form,
            this.settingsStore.getSettings()
        );
        let cleanupError: EpgSourceReconciliationError | undefined;
        try {
            await this.settingsStore.updateSettings(settings, {
                retryEpgCleanup: this.epgUrl?.dirty ?? false,
            });
        } catch (error) {
            if (saveRevision !== this.saveRevision) return;
            if (!(error instanceof EpgSourceReconciliationError)) throw error;
            // This error follows a successful settings write. Mirror the
            // committed values, but retain the dirty form for cleanup retry.
            cleanupError = error;
        }
        if (saveRevision !== this.saveRevision) return;
        if (window.electron) {
            try {
                await window.electron.updateSettings(settings);
            } catch (error) {
                if (saveRevision !== this.saveRevision) return;
                throw new SettingsRuntimeUpdateError(error);
            }
            if (saveRevision !== this.saveRevision) return;

            if (this.runtime.supportsExternalPlayerPathSettings) {
                window.electron.setMpvPlayerPath(settings.mpvPlayerPath);
                window.electron.setVlcPlayerPath(settings.vlcPlayerPath);
            }
        }
        if (cleanupError) throw cleanupError;
        this.takeSavedSnapshot(submittedSnapshot);
        onSaved();
        this.refreshRestartPending();
    }

    /** Later: the reminder stays away until one of those settings changes. */
    dismissRestartNotice(): void {
        const saved = (this.savedSnapshot ?? {}) as Record<string, unknown>;
        for (const control of this.restartPendingControls()) {
            this.launchValues.dismiss(control, saved[control]);
        }
        this.restartPendingControls.set([]);
    }

    /** Applies saved values while keeping edits made during Save available. */
    applySavedSettings(): void {
        if (this.changedPaths().length) this.form.markAsDirty();
        else this.form.markAsPristine();
        // The switch re-renders every date with the new locale; its data is
        // a lazy chunk that must be registered first, and a newer choice
        // must win over an older one whose data arrives later.
        void this.dateLocales.use(
            this.savedSnapshot.language ?? Language.ENGLISH
        );
        // Theme selections preview immediately; an older save must not undo one.
        if (this.form.value.theme === this.savedSnapshot.theme) {
            this.settingsService.changeTheme(
                this.savedSnapshot.theme ?? Theme.SystemTheme
            );
        }
    }

    /**
     * Restart controls whose SAVED value the running app does not use yet.
     * Compares the last saved snapshot, never the draft form: a staged but
     * unsaved edit must not raise or clear the reminder. Called from an
     * effect (the engine probe), so the current list is read untracked and
     * only a changed list is written: a fresh array on every run would
     * re-trigger that effect for ever.
     */
    private refreshRestartPending(): void {
        const running = this.launchValues.get();
        const saved = (this.savedSnapshot ?? {}) as Record<string, unknown>;
        const pending = Object.keys(SETTINGS_RESTART_CONTROLS).filter(
            (control) =>
                control in running &&
                saved[control] !== running[control] &&
                !this.launchValues.isDismissed(control, saved[control])
        );
        const current = untracked(this.restartPendingControls);
        if (
            current.length !== pending.length ||
            current.some((control, index) => control !== pending[index])
        ) {
            this.restartPendingControls.set(pending);
        }
    }

    private takeSavedSnapshot(snapshot = this.form.getRawValue()): void {
        this.savedSnapshot = snapshot;
        this.refreshChangedPaths();
    }

    private refreshChangedPaths(): void {
        this.changedPaths.set(
            diffSettingsValues(this.form.getRawValue(), this.savedSnapshot)
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
