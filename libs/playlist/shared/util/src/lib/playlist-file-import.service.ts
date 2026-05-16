import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import {
    decodeTextBytes,
    Playlist,
    PlaylistSourceVpnConfig,
} from 'shared-interfaces';

const M3U_EXTENSIONS = ['.m3u', '.m3u8'];

export type PlaylistFileImportResult =
    | { ok: true; title: string }
    | { ok: false; reason: 'unsupported' | 'empty' | 'read-error' };

export type NativePlaylistFileImportResult =
    | PlaylistFileImportResult
    | { ok: false; reason: 'cancelled' };

type NativePlaylistFileImportWindow = Window & {
    electron?: {
        getPathForFile?: (file: File) => string;
        openPlaylistFromFile?: () => Promise<Playlist | null>;
    };
};

@Injectable({ providedIn: 'root' })
export class PlaylistFileImportService {
    private readonly store = inject(Store);

    canImportFromNativeDialog(): boolean {
        return Boolean(this.getNativeFileDialog());
    }

    isSupportedFile(file: File): boolean {
        const lower = file.name.toLowerCase();
        return M3U_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }

    async importFromNativeDialog(
        sourceVpn?: PlaylistSourceVpnConfig
    ): Promise<NativePlaylistFileImportResult> {
        const openPlaylistFromFile = this.getNativeFileDialog();
        if (!openPlaylistFromFile) {
            return { ok: false, reason: 'read-error' };
        }

        try {
            const playlist = await openPlaylistFromFile();
            if (!playlist) {
                return { ok: false, reason: 'cancelled' };
            }

            const nextPlaylist = {
                ...playlist,
                ...(sourceVpn ?? {}),
            };

            this.store.dispatch(
                PlaylistActions.addPlaylist({ playlist: nextPlaylist })
            );

            return {
                ok: true,
                title:
                    nextPlaylist.title ||
                    nextPlaylist.filename ||
                    'Untitled playlist',
            };
        } catch {
            return { ok: false, reason: 'read-error' };
        }
    }

    async importFile(
        file: File,
        sourceVpn?: PlaylistSourceVpnConfig
    ): Promise<PlaylistFileImportResult> {
        if (!this.isSupportedFile(file)) {
            return { ok: false, reason: 'unsupported' };
        }

        let playlist: string;
        try {
            playlist = decodeTextBytes(await file.arrayBuffer(), file.type);
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
                playlist,
                title,
                path: this.getFilePath(file),
                ...(sourceVpn ? { sourceVpn } : {}),
            })
        );

        return { ok: true, title };
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
        | (() => Promise<Playlist | null>)
        | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as NativePlaylistFileImportWindow).electron
            ?.openPlaylistFromFile;
    }

    private getNativeFilePathResolver():
        | ((file: File) => string)
        | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as NativePlaylistFileImportWindow).electron
            ?.getPathForFile;
    }
}
