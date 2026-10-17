import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    PlaybackResumeService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import {
    LastPlayingChannel,
    ResumePlaybackSourceType,
    StartupBehavior,
} from '@iptvnator/shared/interfaces';
import { parseWorkspaceShellRoute } from './navigation/workspace-shell-route.utils';

const LAST_RESTORABLE_ROUTE_STORAGE_KEY = 'workspace-last-restorable-route-v1';

@Injectable({ providedIn: 'root' })
export class WorkspaceStartupPreferencesService {
    private readonly settingsStore = inject(SettingsStore);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly playbackResumeService = inject(PlaybackResumeService);

    async resolveInitialWorkspacePath(): Promise<string> {
        await this.settingsStore.loadSettings();

        const resumePath = await this.resolveResumePlaybackPath();
        if (resumePath) return resumePath;

        const showDashboard = this.showDashboard();
        const firstViewPath =
            this.getFirstAvailableWorkspacePath(showDashboard);

        if (this.startupBehavior() !== StartupBehavior.RestoreLastView) {
            return firstViewPath;
        }

        return (
            (await this.getValidatedLastRestorablePath(showDashboard)) ??
            firstViewPath
        );
    }

    private async resolveResumePlaybackPath(): Promise<string | null> {
        if (!this.settingsStore.rememberLastChannel?.()) return null;
        const channel = this.settingsStore.lastPlayingChannel?.();
        if (!channel) return null;
        const path = this.getResumeLiveSectionPath(channel);
        if (!path) return null;
        try {
            const playlists = await firstValueFrom(
                this.playlistsService.getAllPlaylists()
            );
            if (
                !playlists.some(
                    (playlist) => playlist._id === channel.playlistId
                )
            ) {
                return null;
            }
        } catch {
            return null;
        }
        this.playbackResumeService.setPendingResume(
            channel.playlistId,
            channel.streamUrl,
            !!this.settingsStore.autoplayOnRelaunch?.() &&
                !!this.settingsStore.resumePlaybackOnStartup?.(),
            channel.channelId
        );
        return path;
    }

    private getResumeLiveSectionPath(
        channel: LastPlayingChannel
    ): string | null {
        if (!channel.playlistId) return null;
        const sections: Record<ResumePlaybackSourceType, string> = {
            m3u: `/workspace/playlists/${channel.playlistId}/all`,
            xtream: `/workspace/xtreams/${channel.playlistId}/live`,
            stalker: `/workspace/stalker/${channel.playlistId}/itv`,
        };
        return sections[channel.sourceType] ?? null;
    }

    async resolveDashboardPath(): Promise<string> {
        await this.settingsStore.loadSettings();

        return this.showDashboard()
            ? '/workspace/dashboard'
            : '/workspace/sources';
    }

    getFirstAvailableWorkspacePath(
        showDashboard = this.showDashboard()
    ): string {
        return showDashboard ? '/workspace/dashboard' : '/workspace/sources';
    }

    showDashboard(): boolean {
        return this.settingsStore.showDashboard?.() ?? true;
    }

    startupBehavior(): StartupBehavior {
        return (
            this.settingsStore.startupBehavior?.() ?? StartupBehavior.FirstView
        );
    }

    persistLastRestorablePath(url: string): void {
        const canonicalPath = this.getRestorablePath(url);
        if (!canonicalPath) {
            return;
        }

        try {
            localStorage.setItem(
                LAST_RESTORABLE_ROUTE_STORAGE_KEY,
                canonicalPath
            );
        } catch {
            // Ignore storage write failures.
        }
    }

    getRestorablePath(url: string): string | null {
        const [path] = url.split('?');
        if (path === '/workspace' || path === '/workspace/') {
            return null;
        }

        const route = parseWorkspaceShellRoute(url);

        switch (route.kind) {
            case 'dashboard':
                return '/workspace/dashboard';
            case 'downloads':
                return '/workspace/downloads';
            case 'global-favorites':
                return '/workspace/global-favorites';
            case 'global-recent':
                return '/workspace/global-recent';
            case 'sources':
                return '/workspace/sources';
            case 'portal':
                if (!route.context || !route.section) {
                    return null;
                }

                return [
                    '/workspace',
                    route.context.provider,
                    route.context.playlistId,
                    route.section,
                ].join('/');
            default:
                return null;
        }
    }

    async getValidatedLastRestorablePath(
        showDashboard = this.showDashboard()
    ): Promise<string | null> {
        const storedPath = this.readLastRestorablePath();
        if (!storedPath) {
            return null;
        }

        const canonicalPath = this.getRestorablePath(storedPath);
        if (!canonicalPath) {
            return null;
        }

        if (!showDashboard && canonicalPath === '/workspace/dashboard') {
            return this.getFirstAvailableWorkspacePath(false);
        }

        const route = parseWorkspaceShellRoute(canonicalPath);
        if (route.kind !== 'portal' || !route.context) {
            return canonicalPath;
        }

        try {
            const playlists = await firstValueFrom(
                this.playlistsService.getAllPlaylists()
            );

            return playlists.some(
                (playlist) => playlist._id === route.context?.playlistId
            )
                ? canonicalPath
                : this.getFirstAvailableWorkspacePath(showDashboard);
        } catch {
            return this.getFirstAvailableWorkspacePath(showDashboard);
        }
    }

    private readLastRestorablePath(): string | null {
        try {
            const value = localStorage.getItem(
                LAST_RESTORABLE_ROUTE_STORAGE_KEY
            );
            return value && value.trim().length > 0 ? value : null;
        } catch {
            return null;
        }
    }
}
