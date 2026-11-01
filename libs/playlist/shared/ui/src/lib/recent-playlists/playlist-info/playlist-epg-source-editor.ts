import { afterNextRender, inject, Injector } from '@angular/core';
import { UntypedFormArray } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import {
    isRemoteEpgSourceUrl,
    Playlist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    normalizeEpgUrls,
    resolvePlaylistEpgSourceState,
} from '@iptvnator/shared/m3u-utils';
import { createPlaylistEpgSourceControl } from './playlist-info-form';

/** Playlist-local EPG operations; independent Save remains scoped to EPG. */
export class PlaylistEpgSourceEditor {
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly store = inject(Store);
    private readonly injector = inject(Injector);

    constructor(
        private readonly readPlaylist: () => Playlist & { id: string },
        private readonly writePlaylist: (
            playlist: Playlist & { id: string }
        ) => void,
        private readonly readInputs: () => UntypedFormArray
    ) {}

    private get playlist() {
        return this.readPlaylist();
    }
    private set playlist(value: Playlist & { id: string }) {
        this.writePlaylist(value);
    }
    get inputs() {
        return this.readInputs();
    }

    get urls(): string[] {
        return this.normalizeEpgUrls(this.playlist.epgUrls);
    }

    get detectedUrls(): string[] {
        return this.getRawDetectedPlaylistEpgUrls().filter(
            isRemoteEpgSourceUrl
        );
    }

    get enabledDetectedCount(): number {
        const enabledUrls = new Set(this.urls);
        return this.detectedUrls.filter((url) => enabledUrls.has(url)).length;
    }

    get hiddenDetectedUrls(): string[] {
        const enabledUrls = new Set(this.urls);
        return this.detectedUrls.filter((url) => !enabledUrls.has(url));
    }

    get hiddenDetectedCount(): number {
        return this.hiddenDetectedUrls.length;
    }

    originKey(url: string): string {
        if (this.detectedUrls.includes(url))
            return 'SETTINGS.PLAYLIST_EPG_FROM_PLAYLIST';
        return this.normalizeEpgUrls(this.playlist.manualEpgUrls).includes(url)
            ? 'SETTINGS.PLAYLIST_EPG_ADDED_MANUALLY'
            : 'SETTINGS.PLAYLIST_EPG_SAVED_SOURCE';
    }

    enableDetected(url: string, container?: HTMLElement): void {
        if (!this.hiddenDetectedUrls.includes(url)) return;
        this.applyPlaylistEpgSourceState(
            resolvePlaylistEpgSourceState({
                autoImportEpg: this.playlist.autoImportEpg,
                detectedEpgUrls: this.detectedUrls,
                enabledEpgUrls: [...this.urls, url],
                manualEpgUrls: [...(this.playlist.manualEpgUrls ?? []), url],
                disabledEpgUrls: this.normalizeEpgUrls(
                    this.playlist.disabledEpgUrls
                ).filter((value) => value !== url),
            })
        );
        this.focusSourceAction(container, url);
    }

    get canRefresh(): boolean {
        return this.epgBridge.supportsDataManagement;
    }

    get canManage(): boolean {
        return !this.playlist.serverUrl && !this.playlist.macAddress;
    }

    async refresh(url: string): Promise<void> {
        const normalizedUrl = url.trim();
        if (!normalizedUrl) {
            return;
        }

        const result = await this.epgBridge.forceFetchEpg(
            normalizedUrl,
            this.settingsStore.getTrustOptions()
        );

        if (!result) {
            return;
        }

        this.snackBar.open(
            this.translate.instant(
                result.success ? 'EPG.FETCH_SUCCESS' : 'EPG.ERROR'
            ),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
    }

    async addToSettings(url: string, container?: HTMLElement): Promise<void> {
        const epgUrl = url.trim();
        if (!epgUrl || this.isGlobal(epgUrl)) {
            return;
        }

        const currentSettings = this.settingsStore.getSettings();
        await this.settingsStore.updateSettings({
            epgUrl: this.normalizeEpgUrls([
                ...(currentSettings.epgUrl ?? []),
                epgUrl,
            ]),
        });

        this.snackBar.open(
            this.translate.instant('SETTINGS.PLAYLIST_EPG_ADDED_GLOBAL'),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
        this.focusSourceAction(container, url);
    }

    isGlobal(url: string): boolean {
        const normalizedUrl = url.trim();
        if (!normalizedUrl) {
            return false;
        }

        return this.normalizeEpgUrls(
            this.settingsStore.getSettings().epgUrl
        ).includes(normalizedUrl);
    }

    async remove(url: string, container?: HTMLElement): Promise<void> {
        const epgUrl = url.trim();
        if (!epgUrl) {
            return;
        }

        if (this.epgBridge.supportsDataManagement) {
            try {
                const result =
                    await this.epgBridge.clearEpgDataForSource(epgUrl);
                if (result && result.success === false) {
                    throw new Error('Clear EPG source returned false');
                }
            } catch (error) {
                console.error(
                    'Failed to clear playlist EPG source data:',
                    error
                );
                this.snackBar.open(
                    this.translate.instant('SETTINGS.EPG_DATA_CLEAR_FAILED'),
                    this.translate.instant('CLOSE'),
                    { duration: 3000 }
                );
                return;
            }
        }

        const detectedEpgUrls = this.getRawDetectedPlaylistEpgUrls();
        const disabledEpgUrls = this.normalizeEpgUrls(
            this.playlist.disabledEpgUrls
        );
        const nextDisabledEpgUrls = detectedEpgUrls.includes(epgUrl)
            ? this.normalizeEpgUrls([...disabledEpgUrls, epgUrl])
            : disabledEpgUrls.filter((disabledUrl) => disabledUrl !== epgUrl);

        const state = resolvePlaylistEpgSourceState({
            autoImportEpg: this.playlist.autoImportEpg,
            detectedEpgUrls,
            enabledEpgUrls: this.urls.filter(
                (enabledUrl) => enabledUrl !== epgUrl
            ),
            manualEpgUrls: this.normalizeEpgUrls(
                this.playlist.manualEpgUrls
            ).filter((manualUrl) => manualUrl !== epgUrl),
            disabledEpgUrls: nextDisabledEpgUrls,
        });

        this.applyPlaylistEpgSourceState(state);
        this.focusSourceAction(container, url);
    }

    addInput(): void {
        this.inputs.push(createPlaylistEpgSourceControl());
    }

    get canBrowseFiles(): boolean {
        return this.epgBridge.supportsFilePicker;
    }

    /** Native picker for a local XMLTV file; fills EPG input `index`. */
    async browseInput(index: number): Promise<void> {
        const control = this.inputs.at(index);
        if (!control || !this.epgBridge.supportsFilePicker) {
            return;
        }
        const filePath = await this.epgBridge.pickEpgFile();
        if (!filePath) {
            return;
        }
        control.setValue(filePath);
        control.markAsDirty();
        control.markAsTouched();
    }

    removeInput(index: number): void {
        if (this.inputs.length <= 1) {
            this.inputs.at(0).reset('');
            return;
        }

        this.inputs.removeAt(index);
    }

    save(): void {
        if (this.inputs.invalid) {
            this.inputs.markAllAsTouched();
            return;
        }

        const state = this.draftSourceState();
        if (!state) return;

        this.applyPlaylistEpgSourceState(state);
        this.resetPlaylistEpgSourceInputs();
    }

    /** Include valid new rows in the main Save without an earlier EPG-only write.
     * No draft mutates the persisted source set before a shared save succeeds. */
    prepareSave(playlist: PlaylistMeta): PlaylistMeta {
        const { playlistEpgSourceInputs: draftControls, ...metadata } =
            playlist as PlaylistMeta & { playlistEpgSourceInputs?: unknown };
        void draftControls;
        const state = this.canManage ? this.draftSourceState() : null;
        return state ? { ...metadata, ...state } : metadata;
    }

    private draftSourceState() {
        const addedUrls = this.normalizeEpgUrls(this.inputs.value as string[]);
        if (addedUrls.length === 0) {
            return null;
        }

        const addedUrlSet = new Set(addedUrls);
        return resolvePlaylistEpgSourceState({
            autoImportEpg: this.playlist.autoImportEpg,
            detectedEpgUrls: this.getRawDetectedPlaylistEpgUrls(),
            enabledEpgUrls: this.normalizeEpgUrls([...this.urls, ...addedUrls]),
            manualEpgUrls: this.normalizeEpgUrls([
                ...(this.playlist.manualEpgUrls ?? []),
                ...addedUrls,
            ]),
            disabledEpgUrls: this.normalizeEpgUrls(
                this.playlist.disabledEpgUrls
            ).filter((url) => !addedUrlSet.has(url)),
        });
    }

    private normalizeEpgUrls(urls?: string[] | null): string[] {
        return normalizeEpgUrls(urls ?? []);
    }

    private getRawDetectedPlaylistEpgUrls(): string[] {
        return this.normalizeEpgUrls(this.playlist.detectedEpgUrls);
    }

    private applyPlaylistEpgSourceState(
        state: ReturnType<typeof resolvePlaylistEpgSourceState>
    ): void {
        const playlistMeta = {
            _id: this.playlist._id,
            epgUrls: state.epgUrls,
            detectedEpgUrls: state.detectedEpgUrls,
            manualEpgUrls: state.manualEpgUrls,
            disabledEpgUrls: state.disabledEpgUrls,
        } as PlaylistMeta;

        this.playlist = {
            ...this.playlist,
            ...playlistMeta,
        };
        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({ playlist: playlistMeta })
        );
    }

    private resetPlaylistEpgSourceInputs(): void {
        // Keep the first control (and its view) mounted. Replacing it under
        // the same index left the old value in the input after an EPG save.
        while (this.inputs.length > 1) {
            this.inputs.removeAt(this.inputs.length - 1);
        }
        this.inputs.at(0).reset('');
    }

    private focusSourceAction(container?: HTMLElement, url?: string): void {
        if (!container?.isConnected) return;
        afterNextRender(
            () => {
                if (!container.isConnected) return;
                const rows = Array.from(
                    container.querySelectorAll<HTMLElement>(
                        '[data-epg-source-state="enabled"]'
                    )
                );
                const row = rows.find(
                    (value) =>
                        value.querySelector<HTMLInputElement>('input')
                            ?.value === url
                );
                const next =
                    row?.querySelector<HTMLButtonElement>(
                        'button:not(:disabled)'
                    ) ??
                    container.querySelector<HTMLButtonElement>(
                        '[data-epg-source-state="enabled"] button:not(:disabled), [data-test-id="add-playlist-epg-source"]'
                    );
                next?.focus();
            },
            { injector: this.injector }
        );
    }
}
