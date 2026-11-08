import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { Playlist, PlaylistImportScope } from '@iptvnator/shared/interfaces';
import {
    applyImportScopeToPlaylist,
    applyPlaylistEpgImportPreference,
} from '@iptvnator/shared/m3u-utils';
import { SettingsStore } from '@iptvnator/services';

const M3U_EXTENSIONS = ['.m3u', '.m3u8'];

export type PlaylistFileImportResult =
    | { ok: true; title: string }
    | { ok: false; reason: 'unsupported' | 'empty' | 'read-error' };

export type NativePlaylistFileImportResult =
    PlaylistFileImportResult | { ok: false; reason: 'cancelled' };

type NativePlaylistFileImportWindow = Window & {
    electron?: {
        getPathForFile?: (file: File) => string;
        openPlaylistFromFile?: () => Promise<Playlist | null>;
        updatePlaylistFromFilePath?: (
            filePath: string,
            title: string
        ) => Promise<Playlist | null>;
    };
};

export interface PlaylistFileImportOptions {
    /** Per-source live/VOD sections. Absent flags mean both are imported. */
    scope?: PlaylistImportScope;
    /** Import-time EPG opt-out; default keeps discovered EPG links. */
    autoImportEpg?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PlaylistFileImportService {
    private readonly store = inject(Store);
    private readonly settingsStore = inject(SettingsStore);

    canImportFromNativeDialog(): boolean {
        return Boolean(this.getNativeFileDialog());
    }

    isSupportedFile(file: File): boolean {
        return this.isSupportedPath(file.name);
    }

    isSupportedPath(fileNameOrPath: string): boolean {
        const lower = fileNameOrPath.trim().toLowerCase();
        return M3U_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }

    async importFromNativeDialog(
        options: PlaylistFileImportOptions = {}
    ): Promise<NativePlaylistFileImportResult> {
        const { scope, autoImportEpg = true } = options;
        const openPlaylistFromFile = this.getNativeFileDialog();
        if (!openPlaylistFromFile) {
            return { ok: false, reason: 'read-error' };
        }

        try {
            const parsed = await openPlaylistFromFile();
            if (!parsed) {
                return { ok: false, reason: 'cancelled' };
            }
            const playlist = applyImportScopeToPlaylist(
                parsed,
                scope,
                this.settingsStore.disableVod?.() === true
            );

            this.store.dispatch(
                PlaylistActions.addPlaylist({
                    playlist: applyPlaylistEpgImportPreference(
                        playlist,
                        autoImportEpg
                    ),
                })
            );

            return {
                ok: true,
                title:
                    playlist.title || playlist.filename || 'Untitled playlist',
            };
        } catch {
            return { ok: false, reason: 'read-error' };
        }
    }

    /**
     * Imports a playlist the main process already resolved to a path — the OS
     * "open with" / command line route, where there is no `File` handle. The
     * extension guard mirrors {@link isSupportedFile} so a path that slipped
     * through is rejected here rather than read.
     */
    async importFromPath(
        filePath: string,
        fileName?: string,
        options: PlaylistFileImportOptions = {}
    ): Promise<PlaylistFileImportResult> {
        const { scope, autoImportEpg = true } = options;
        const title = this.normalizeTitle(
            fileName?.trim() || this.baseNameFromPath(filePath)
        );

        if (!this.isSupportedPath(filePath)) {
            return { ok: false, reason: 'unsupported' };
        }

        const parseFromPath = this.getNativeFilePathParser();
        if (!parseFromPath) {
            return { ok: false, reason: 'read-error' };
        }

        try {
            const parsed = await parseFromPath(filePath, title);
            if (!parsed) {
                return { ok: false, reason: 'read-error' };
            }
            const playlist = applyImportScopeToPlaylist(
                parsed,
                scope,
                this.settingsStore.disableVod?.() === true
            );

            this.store.dispatch(
                PlaylistActions.addPlaylist({
                    playlist: applyPlaylistEpgImportPreference(
                        playlist,
                        autoImportEpg
                    ),
                })
            );

            return { ok: true, title: playlist.title || title };
        } catch {
            return { ok: false, reason: 'read-error' };
        }
    }

    async importFile(
        file: File,
        options: PlaylistFileImportOptions = {}
    ): Promise<PlaylistFileImportResult> {
        const { scope, autoImportEpg = true } = options;
        if (!this.isSupportedFile(file)) {
            return { ok: false, reason: 'unsupported' };
        }

        let playlist: string;
        try {
            playlist = await file.text();
        } catch {
            return { ok: false, reason: 'read-error' };
        }

        if (!playlist.trim()) {
            return { ok: false, reason: 'empty' };
        }

        const title = this.normalizeTitle(file.name);
        this.store.dispatch(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                ...(autoImportEpg ? {} : { autoImportEpg: false }),
                playlist,
                title,
                path: this.getFilePath(file),
                importLive: scope?.importLive,
                importVod: scope?.importVod,
            })
        );

        return { ok: true, title };
    }

    /** Renderer-side `basename`; handles both POSIX and Windows separators. */
    private baseNameFromPath(filePath: string): string {
        const segments = filePath.trim().split(/[\\/]/);
        return segments[segments.length - 1] || filePath;
    }

    private normalizeTitle(filename: string): string {
        const trimmed = filename.trim();
        if (!trimmed) {
            return filename;
        }
        return trimmed.replace(/\.(m3u8?|pls|txt)$/i, '') || trimmed;
    }

    private getFilePath(file: File): string | undefined {
        const directPath = (file as File & { path?: string }).path?.trim();
        if (directPath) {
            return directPath;
        }

        const getPathForFile = this.getNativeFilePathResolver();
        if (!getPathForFile) {
            return undefined;
        }

        try {
            const resolvedPath = getPathForFile(file).trim();
            return resolvedPath || undefined;
        } catch {
            return undefined;
        }
    }

    private getNativeFileDialog():
        (() => Promise<Playlist | null>) | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as NativePlaylistFileImportWindow).electron
            ?.openPlaylistFromFile;
    }

    private getNativeFilePathParser():
        | ((filePath: string, title: string) => Promise<Playlist | null>)
        | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as NativePlaylistFileImportWindow).electron
            ?.updatePlaylistFromFilePath;
    }

    private getNativeFilePathResolver(): ((file: File) => string) | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as NativePlaylistFileImportWindow).electron
            ?.getPathForFile;
    }
}
