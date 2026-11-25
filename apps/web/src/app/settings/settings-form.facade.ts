import { normalizeAgeRatingCountry } from '@iptvnator/shared/interfaces/age-rating';
import {
    DestroyRef,
    effect,
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
    ThemeAccent,
    ThemeMode,
    type Settings,
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
    normalizeSavedAppearance,
    previewSystemThemes,
    restoreSavedAppearance,
} from './settings-theme-preview';
import {
    applyEpgUrlsToFormArray,
    createEpgUrlControl,
    createSettingsForm,
    createSettingsFromFormValue,
    reconcileEpgFormArray,
    SettingsForm,
} from './settings-form.utils';
import { SettingsFormWrites } from './settings-form-writes';
import {
    pickChangedSettings,
    readSettingsPath,
    SettingsFormSubmission,
    rebaseSettingsForm,
} from './settings-form-rebase';

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
    private saveNeedsConfirmation = false;
    /**
     * Paths an unfinished save wrote. A newer save writes them again, so an
     * edit reverted to the saved value still overrides the older save.
     */
    private readonly unsettledSavePaths = new Set<string>();
    private readonly writes = new SettingsFormWrites();

    constructor() {
        this.form.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refreshChangedPaths());
        effect(() => {
            const key = this.settingsStore.savedTmdbApiKey();
            untracked(() => this.syncSavedTmdbKey(key));
        });
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
        // A full reload ends any half-failed save: its paths are not staged
        // any more and must not be rewritten from the reloaded form.
        this.saveNeedsConfirmation = false;
        this.unsettledSavePaths.clear();
        this.writes.clear();
        const currentSettings = this.settingsStore.getSettings();
        this.form.patchValue({
            ...currentSettings,
            ageRatingCountry: normalizeAgeRatingCountry(
                currentSettings.ageRatingCountry
            ),
            ...normalizeSavedAppearance(currentSettings),
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

    /** The preset System shows in one device mode; previews like the theme. */
    selectSystemTheme(mode: ThemeMode, theme: Theme): void {
        const control =
            mode === 'dark' ? 'systemDarkTheme' : 'systemLightTheme';
        if (this.form.value[control] === theme) {
            return;
        }

        this.patchAndMarkDirty({ [control]: theme }, control);
        previewSystemThemes(this.settingsService, this.form.value);
    }

    /** Previews immediately like the theme; the write happens on Save. */
    selectThemeAccent(themeAccent: ThemeAccent | null): void {
        if ((this.form.value.themeAccent ?? null) === themeAccent) {
            return;
        }

        this.patchAndMarkDirty({ themeAccent }, 'themeAccent');
        void this.settingsService.changeThemeAccent(themeAccent);
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
        if (this.form.value.epgViewMode === epgViewMode) return;

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
     * Persists the staged edits to the settings store and mirrors the result
     * to the desktop backend. Only the paths changed on the form are written:
     * a setting another surface changed while the page was open (the command
     * palette's player switch, a restored backup's EPG sources) keeps its
     * newer value.
     * @param onSaved runs after persistence and the desktop backend update
     * succeed, so runtime failures keep the form available for retry.
     */
    async save(onSaved: () => void): Promise<void> {
        const saveRevision = ++this.saveRevision;
        this.saveNeedsConfirmation = true;
        const submittedSnapshot = this.form.getRawValue();
        // An unsettled save may have stored another key already; a key typed
        // back to the saved one must then be written to override it.
        for (const path of diffSettingsValues(
            submittedSnapshot,
            this.savedSnapshot
        ))
            this.unsettledSavePaths.add(path);
        const submission = {
            paths: [...this.unsettledSavePaths],
            snapshot: submittedSnapshot,
            baseline: this.savedSnapshot,
        };
        const stored = this.settingsStore.getSettings();
        const settings = pickChangedSettings(
            createSettingsFromFormValue(this.form, stored),
            submission.paths,
            stored
        );
        if (
            !this.writes.hasUnsettledTmdbKey &&
            settings.tmdb?.apiKey ===
                (this.savedSnapshot.tmdb.apiKey?.trim() ?? '')
        ) {
            delete settings.tmdb.apiKey;
            this.unsettledSavePaths.delete('tmdb.apiKey');
        }
        const write = this.writes.prepare(
            saveRevision,
            submittedSnapshot.epgUrl,
            settings,
            submission.baseline.epgUrl,
            stored.epgUrl,
            this.epgUrl?.dirty ?? false
        );
        let cleanupError: EpgSourceReconciliationError | undefined;
        try {
            await this.settingsStore.updateSettings(settings, ...write);
        } catch (error) {
            const cleanupFailed = error instanceof EpgSourceReconciliationError;
            if (!cleanupFailed && this.writes.reject(saveRevision)) {
                if (!this.writes.hasUnsettledTmdbKey)
                    this.unsettledSavePaths.delete('tmdb.apiKey');
                this.syncSavedTmdbKey(this.settingsStore.savedTmdbApiKey());
            }
            if (saveRevision !== this.saveRevision) return;
            if (!cleanupFailed) throw error;
            // This error follows a successful settings write. Mirror the
            // committed values, but retain the dirty form for cleanup retry.
            cleanupError = error;
        }
        if (saveRevision !== this.saveRevision) return;
        if (window.electron) {
            // The backend mirrors the merged settings, never the bare patch.
            const applied: Partial<Settings> = {
                ...this.settingsStore.getSettings(),
            };
            delete applied.parentalLockEnabled;
            try {
                await window.electron.updateSettings(applied);
            } catch (error) {
                if (saveRevision !== this.saveRevision) return;
                throw new SettingsRuntimeUpdateError(error);
            }
            if (saveRevision !== this.saveRevision) return;

            if (this.runtime.supportsExternalPlayerPathSettings) {
                window.electron.setMpvPlayerPath(applied.mpvPlayerPath ?? '');
                window.electron.setVlcPlayerPath(applied.vlcPlayerPath ?? '');
            }
        }
        if (cleanupError) throw cleanupError;
        this.rebaseOnStore(submission);
        this.saveNeedsConfirmation = false;
        this.unsettledSavePaths.clear();
        this.writes.clear();
        onSaved();
        this.refreshRestartPending();
    }

    /**
     * Takes in settings written outside the form while the page is open (a
     * restored backup) without dropping staged edits; a form left with
     * nothing to save turns pristine again.
     */
    syncWithStore(): void {
        this.rebaseOnStore();
        if (!this.changedPaths().length && !this.saveNeedsConfirmation) {
            this.form.markAsPristine();
        }
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

    applyTransferredTmdbKey(): void {
        const apiKey = this.settingsStore.getSettings().tmdb?.apiKey ?? '';
        this.syncSavedTmdbKey(apiKey, true);
        this.settingsSnackbar.tmdbKeySaved();
    }

    private syncSavedTmdbKey(
        apiKey: string | undefined,
        replaceDraft = false
    ): void {
        if (
            apiKey === undefined ||
            (!replaceDraft && !this.writes.canAdoptTmdbKey(apiKey))
        )
            return;
        const control = this.form.controls.tmdb.controls.apiKey;
        const previous =
            this.writes.persistedTmdbKey ?? this.savedSnapshot.tmdb.apiKey;
        const hasDraft =
            (control.value?.trim() ?? '') !== (previous?.trim() ?? '');
        if (!replaceDraft) {
            this.writes.persistedTmdbKey = undefined;
            this.unsettledSavePaths.delete('tmdb.apiKey');
        }
        this.savedSnapshot = {
            ...this.savedSnapshot,
            tmdb: { ...this.savedSnapshot.tmdb, apiKey },
        };
        if (replaceDraft || !hasDraft) control.setValue(apiKey);
        else this.refreshChangedPaths();
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
        restoreSavedAppearance(
            this.settingsService,
            this.form.value,
            this.savedSnapshot
        );
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

    /** Adopts stored values while retaining any edits still in the form. */
    private rebaseOnStore(submitted?: SettingsFormSubmission): void {
        const current = this.form.getRawValue();
        const epgUrl = this.settingsStore.getCommittedEpgUrls();
        const { next, staged, addedEpgUrls } = rebaseSettingsForm(
            current,
            this.savedSnapshot,
            { ...this.settingsStore.getSettings(), epgUrl },
            this.unsettledSavePaths,
            this.writes.knownUrls(this.savedSnapshot.epgUrl),
            {
                submitted,
                pendingEpgUrls: this.writes.submittedEpgUrls,
                persistedEpgSources: this.writes.persistedEpgSources,
                confirmedTmdbKey: this.settingsStore.savedTmdbApiKey(),
            }
        );
        for (const path of diffSettingsValues(next, current)) {
            if (staged.has(path)) continue;
            if (path === 'epgUrl')
                next.epgUrl = reconcileEpgFormArray(this.epgUrl, next.epgUrl);
            else this.form.get(path)?.setValue(readSettingsPath(next, path));
        }
        if (addedEpgUrls.length) this.setEpgUrls(addedEpgUrls);
        this.takeSavedSnapshot(next);
    }

    private takeSavedSnapshot(snapshot = this.form.getRawValue()): void {
        this.writes.rebase(this.savedSnapshot.epgUrl, snapshot.epgUrl);
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
