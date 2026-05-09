import { app, dialog, powerSaveBlocker } from 'electron';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    unlinkSync,
} from 'fs';
import { createRequire } from 'module';
import path from 'path';
import App from '../app';
import {
    EmbeddedMpvAudioTrack,
    EmbeddedMpvBounds,
    EmbeddedMpvCapabilities,
    EmbeddedMpvRecordingStartOptions,
    EmbeddedMpvRecordingState,
    EmbeddedMpvSession,
    EmbeddedMpvSessionStatus,
    EmbeddedMpvSubtitleTrack,
    EmbeddedMpvSupport,
    EMBEDDED_MPV_SESSION_UPDATE,
    ResolvedPortalPlayback,
} from 'shared-interfaces';

interface NativeEmbeddedMpvSessionSnapshot {
    status: EmbeddedMpvSessionStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    streamUrl: string;
    audioTracks?: EmbeddedMpvAudioTrack[];
    selectedAudioTrackId?: number | null;
    subtitleTracks?: EmbeddedMpvSubtitleTrack[];
    selectedSubtitleTrackId?: number | null;
    playbackSpeed?: number;
    aspectOverride?: string;
    recording?: EmbeddedMpvRecordingState;
    error?: string;
}

interface NativeEmbeddedMpvAddon {
    isSupported(): boolean;
    createSession(
        windowHandle: Buffer,
        bounds: EmbeddedMpvBounds,
        title?: string,
        initialVolume?: number
    ): string;
    loadPlayback(sessionId: string, playback: ResolvedPortalPlayback): void;
    setBounds(sessionId: string, bounds: EmbeddedMpvBounds): void;
    setPaused(sessionId: string, paused: boolean): void;
    seek(sessionId: string, seconds: number): void;
    setVolume(sessionId: string, volume: number): void;
    setAudioTrack(sessionId: string, trackId: number): void;
    setSubtitleTrack?(sessionId: string, trackId: number): void;
    setSpeed?(sessionId: string, speed: number): void;
    setAspect?(sessionId: string, aspect: string): void;
    startRecording?(sessionId: string, targetPath: string): void;
    stopRecording?(sessionId: string): void;
    getSessionSnapshot(
        sessionId: string
    ): NativeEmbeddedMpvSessionSnapshot | null;
    disposeSession(sessionId: string): void;
}

interface EmbeddedMpvRuntimeSession {
    id: string;
    title: string;
    streamUrl: string;
    startedAt: string;
    updatedAt: string;
    lastPayloadKey: string;
    lastStatus: EmbeddedMpvSessionStatus | null;
}

const EMBEDDED_MPV_EXPERIMENT_ENV = 'IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT';

function dedupePaths(paths: Array<string | undefined>): string[] {
    return [
        ...new Set(paths.filter((value): value is string => Boolean(value))),
    ];
}

export class EmbeddedMpvNativeService {
    private addon: NativeEmbeddedMpvAddon | null = null;
    private addonLoadError: Error | null = null;
    private readonly sessions = new Map<string, EmbeddedMpvRuntimeSession>();
    private pollingTimer: NodeJS.Timeout | null = null;
    private powerBlockerId: number | null = null;
    private readonly loadAddonModule = createRequire(__filename);

    private detectCapabilities(): EmbeddedMpvCapabilities {
        const addon = this.addon;
        return {
            subtitles: typeof addon?.setSubtitleTrack === 'function',
            playbackSpeed: typeof addon?.setSpeed === 'function',
            aspectOverride: typeof addon?.setAspect === 'function',
            screenshot: false,
            recording:
                typeof addon?.startRecording === 'function' &&
                typeof addon?.stopRecording === 'function',
        };
    }

    getSupport(): EmbeddedMpvSupport {
        if (process.platform !== 'darwin') {
            return {
                supported: false,
                platform: process.platform,
                reason: 'Embedded MPV is currently available on macOS only.',
            };
        }

        if (!this.isEmbeddedMpvEnabled()) {
            return {
                supported: false,
                platform: process.platform,
                reason: `Embedded MPV is a macOS-only experimental player. Set ${EMBEDDED_MPV_EXPERIMENT_ENV}=1 to enable it for local development builds.`,
            };
        }

        if (this.addon) {
            try {
                if (!this.addon.isSupported()) {
                    return {
                        supported: false,
                        platform: process.platform,
                        reason: 'The native embedded MPV addon reported itself as unsupported.',
                    };
                }

                return {
                    supported: true,
                    platform: process.platform,
                    capabilities: this.detectCapabilities(),
                };
            } catch (error) {
                return {
                    supported: false,
                    platform: process.platform,
                    reason:
                        error instanceof Error ? error.message : String(error),
                };
            }
        }

        if (this.addonLoadError) {
            return {
                supported: false,
                platform: process.platform,
                reason: this.addonLoadError.message,
            };
        }

        const candidatePaths = this.getAddonCandidatePaths();
        const existingCandidatePath = candidatePaths.find((candidatePath) =>
            existsSync(candidatePath)
        );

        if (!existingCandidatePath) {
            return {
                supported: false,
                platform: process.platform,
                reason:
                    this.readUnavailableReason(candidatePaths) ??
                    [
                        'Unable to locate the embedded MPV native addon.',
                        ...candidatePaths.map(
                            (candidatePath) => `- ${candidatePath}`
                        ),
                    ].join('\n'),
            };
        }

        const missingRuntimeReason = this.getMissingRuntimeReason(
            existingCandidatePath
        );
        if (missingRuntimeReason) {
            return {
                supported: false,
                platform: process.platform,
                reason: missingRuntimeReason,
            };
        }

        try {
            const addon = this.getAddon();
            if (!addon.isSupported()) {
                return {
                    supported: false,
                    platform: process.platform,
                    reason: 'The native embedded MPV addon reported itself as unsupported.',
                };
            }

            return {
                supported: true,
                platform: process.platform,
                capabilities: this.detectCapabilities(),
            };
        } catch (error) {
            return {
                supported: false,
                platform: process.platform,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    prepareAddon(): EmbeddedMpvSupport {
        const support = this.getSupport();
        if (!support.supported) {
            return support;
        }

        try {
            const addon = this.getAddon();
            if (!addon.isSupported()) {
                return {
                    supported: false,
                    platform: process.platform,
                    reason: 'The native embedded MPV addon reported itself as unsupported.',
                };
            }

            return {
                supported: true,
                platform: process.platform,
                capabilities: this.detectCapabilities(),
            };
        } catch (error) {
            return {
                supported: false,
                platform: process.platform,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    createSession(
        bounds: EmbeddedMpvBounds,
        title = '',
        initialVolume = 1
    ): EmbeddedMpvSession {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        const windowHandle = this.getMainWindowHandle();
        const startedAt = new Date().toISOString();
        const sessionId = addon.createSession(
            windowHandle,
            bounds,
            title,
            initialVolume
        );

        this.sessions.set(sessionId, {
            id: sessionId,
            title,
            streamUrl: '',
            startedAt,
            updatedAt: startedAt,
            lastPayloadKey: '',
            lastStatus: null,
        });

        this.ensurePolling();
        return (
            this.refreshSession(sessionId) ?? {
                id: sessionId,
                title,
                streamUrl: '',
                status: 'idle',
                positionSeconds: 0,
                durationSeconds: null,
                volume: 1,
                audioTracks: [],
                selectedAudioTrackId: null,
                subtitleTracks: [],
                selectedSubtitleTrackId: null,
                playbackSpeed: 1,
                aspectOverride: 'no',
                recording: { active: false },
                startedAt,
                updatedAt: startedAt,
            }
        );
    }

    loadPlayback(sessionId: string, playback: ResolvedPortalPlayback): void {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        const session = this.getRuntimeSession(sessionId);
        session.title = playback.title ?? session.title;
        session.streamUrl = playback.streamUrl ?? session.streamUrl;
        session.updatedAt = new Date().toISOString();
        addon.loadPlayback(sessionId, playback);
        this.refreshSession(sessionId);
    }

    setBounds(sessionId: string, bounds: EmbeddedMpvBounds): void {
        this.assertEmbeddedMpvEnabled();
        this.getAddon().setBounds(sessionId, bounds);
    }

    setPaused(sessionId: string, paused: boolean): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        this.getAddon().setPaused(sessionId, paused);
        return this.refreshSession(sessionId);
    }

    seek(sessionId: string, seconds: number): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        this.getAddon().seek(sessionId, seconds);
        return this.refreshSession(sessionId);
    }

    setVolume(sessionId: string, volume: number): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        this.getAddon().setVolume(sessionId, volume);
        return this.refreshSession(sessionId);
    }

    setAudioTrack(
        sessionId: string,
        trackId: number
    ): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        this.getAddon().setAudioTrack(sessionId, trackId);
        return this.refreshSession(sessionId);
    }

    setSubtitleTrack(
        sessionId: string,
        trackId: number
    ): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        if (typeof addon.setSubtitleTrack !== 'function') {
            throw new Error(
                'Embedded MPV addon does not support subtitle tracks. Rebuild the native addon to enable this feature.'
            );
        }
        addon.setSubtitleTrack(sessionId, trackId);
        return this.refreshSession(sessionId);
    }

    setSpeed(sessionId: string, speed: number): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        if (typeof addon.setSpeed !== 'function') {
            throw new Error(
                'Embedded MPV addon does not support playback speed. Rebuild the native addon to enable this feature.'
            );
        }
        addon.setSpeed(sessionId, speed);
        return this.refreshSession(sessionId);
    }

    setAspect(sessionId: string, aspect: string): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        if (typeof addon.setAspect !== 'function') {
            throw new Error(
                'Embedded MPV addon does not support aspect override. Rebuild the native addon to enable this feature.'
            );
        }
        addon.setAspect(sessionId, aspect);
        return this.refreshSession(sessionId);
    }

    startRecording(
        sessionId: string,
        options: EmbeddedMpvRecordingStartOptions = {}
    ): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        if (
            typeof addon.startRecording !== 'function' ||
            typeof addon.stopRecording !== 'function'
        ) {
            throw new Error(
                'Embedded MPV addon does not support stream recording. Rebuild the native addon to enable this feature.'
            );
        }

        const session = this.getRuntimeSession(sessionId);
        const directory =
            options.directory?.trim() || this.getDefaultRecordingFolder();
        mkdirSync(directory, { recursive: true });

        const targetPath = this.reserveRecordingTargetPath(
            directory,
            options.title || session.title || 'IPTVnator recording'
        );
        try {
            addon.startRecording(sessionId, targetPath);
        } catch (error) {
            this.releaseReservedRecordingTargetPath(targetPath);
            throw error;
        }
        return this.refreshSession(sessionId);
    }

    stopRecording(sessionId: string): EmbeddedMpvSession | null {
        this.assertEmbeddedMpvEnabled();
        const addon = this.getAddon();
        if (typeof addon.stopRecording !== 'function') {
            throw new Error(
                'Embedded MPV addon does not support stream recording. Rebuild the native addon to enable this feature.'
            );
        }
        addon.stopRecording(sessionId);
        return this.refreshSession(sessionId);
    }

    getDefaultRecordingFolder(): string {
        return app.getPath('downloads');
    }

    async selectRecordingFolder(): Promise<string | null> {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Recording Folder',
            defaultPath: this.getDefaultRecordingFolder(),
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    }

    disposeSession(sessionId: string): EmbeddedMpvSession | null {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        let lastRecording: EmbeddedMpvRecordingState | undefined;
        try {
            const addon = this.getAddon();
            try {
                lastRecording = addon.getSessionSnapshot(sessionId)?.recording;
            } catch {
                lastRecording = undefined;
            }
            addon.disposeSession(sessionId);
        } finally {
            this.sessions.delete(sessionId);
            const payload: EmbeddedMpvSession = {
                id: session.id,
                title: session.title,
                streamUrl: session.streamUrl,
                status: 'closed',
                positionSeconds: 0,
                durationSeconds: null,
                volume: 1,
                audioTracks: [],
                selectedAudioTrackId: null,
                subtitleTracks: [],
                selectedSubtitleTrackId: null,
                playbackSpeed: 1,
                aspectOverride: 'no',
                recording: this.createClosedRecordingState(lastRecording),
                startedAt: session.startedAt,
                updatedAt: new Date().toISOString(),
            };
            this.sendSessionUpdate(payload);
            this.stopPollingIfIdle();
            this.updatePowerBlocker();
            return payload;
        }
    }

    shutdown(): void {
        const sessionIds = [...this.sessions.keys()];
        sessionIds.forEach((sessionId) => this.disposeSession(sessionId));
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.updatePowerBlocker();
    }

    private ensurePolling(): void {
        if (this.pollingTimer) {
            return;
        }

        this.pollingTimer = setInterval(() => {
            [...this.sessions.keys()].forEach((sessionId) => {
                this.refreshSession(sessionId);
            });
        }, 500);
    }

    private stopPollingIfIdle(): void {
        if (this.sessions.size > 0 || !this.pollingTimer) {
            return;
        }

        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
    }

    private refreshSession(sessionId: string): EmbeddedMpvSession | null {
        const addon = this.getAddon();
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        const snapshot = addon.getSessionSnapshot(sessionId);
        if (!snapshot) {
            return null;
        }

        const payload: EmbeddedMpvSession = {
            id: session.id,
            title: session.title,
            streamUrl: snapshot.streamUrl || session.streamUrl,
            status: snapshot.status,
            positionSeconds: Math.max(0, Math.floor(snapshot.positionSeconds)),
            durationSeconds:
                typeof snapshot.durationSeconds === 'number'
                    ? Math.max(0, Math.floor(snapshot.durationSeconds))
                    : null,
            volume: typeof snapshot.volume === 'number' ? snapshot.volume : 1,
            audioTracks: Array.isArray(snapshot.audioTracks)
                ? snapshot.audioTracks
                : [],
            selectedAudioTrackId:
                typeof snapshot.selectedAudioTrackId === 'number'
                    ? snapshot.selectedAudioTrackId
                    : null,
            subtitleTracks: Array.isArray(snapshot.subtitleTracks)
                ? snapshot.subtitleTracks
                : [],
            selectedSubtitleTrackId:
                typeof snapshot.selectedSubtitleTrackId === 'number'
                    ? snapshot.selectedSubtitleTrackId
                    : null,
            playbackSpeed:
                typeof snapshot.playbackSpeed === 'number'
                    ? snapshot.playbackSpeed
                    : 1,
            aspectOverride:
                typeof snapshot.aspectOverride === 'string'
                    ? snapshot.aspectOverride
                    : 'no',
            recording: snapshot.recording ?? { active: false },
            startedAt: session.startedAt,
            updatedAt: new Date().toISOString(),
            ...(snapshot.error ? { error: snapshot.error } : {}),
        };

        session.streamUrl = payload.streamUrl;
        session.updatedAt = payload.updatedAt;
        session.lastStatus = payload.status;
        const nextPayloadKey = JSON.stringify(payload);
        if (session.lastPayloadKey !== nextPayloadKey) {
            session.lastPayloadKey = nextPayloadKey;
            this.sendSessionUpdate(payload);
        }

        this.updatePowerBlocker();
        return payload;
    }

    private hasPlayingSession(): boolean {
        for (const session of this.sessions.values()) {
            if (session.lastStatus === 'playing') {
                return true;
            }
        }
        return false;
    }

    private updatePowerBlocker(): void {
        const shouldBlock = this.hasPlayingSession();

        if (shouldBlock && this.powerBlockerId === null) {
            try {
                this.powerBlockerId = powerSaveBlocker.start(
                    'prevent-display-sleep'
                );
            } catch {
                this.powerBlockerId = null;
            }
            return;
        }

        if (!shouldBlock && this.powerBlockerId !== null) {
            const blockerId = this.powerBlockerId;
            this.powerBlockerId = null;
            try {
                if (powerSaveBlocker.isStarted(blockerId)) {
                    powerSaveBlocker.stop(blockerId);
                }
            } catch {
                // ignore — assertion will be cleaned up when the process exits
            }
        }
    }

    private sendSessionUpdate(session: EmbeddedMpvSession): void {
        if (!App.mainWindow || App.mainWindow.isDestroyed()) {
            return;
        }

        App.mainWindow.webContents.send(EMBEDDED_MPV_SESSION_UPDATE, session);
    }

    private getRuntimeSession(sessionId: string): EmbeddedMpvRuntimeSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(
                `Embedded MPV session "${sessionId}" was not found.`
            );
        }

        return session;
    }

    private getMainWindowHandle(): Buffer {
        if (!App.mainWindow || App.mainWindow.isDestroyed()) {
            throw new Error('The Electron main window is not available.');
        }

        return App.mainWindow.getNativeWindowHandle();
    }

    private reserveRecordingTargetPath(
        directory: string,
        title: string
    ): string {
        const baseName = this.sanitizeRecordingFileName(title);
        const timestamp = this.formatRecordingTimestamp(new Date());
        let candidate = path.join(directory, `${baseName}-${timestamp}.ts`);
        let suffix = 2;

        while (true) {
            try {
                const fd = openSync(candidate, 'wx');
                closeSync(fd);
                return candidate;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    candidate = path.join(
                        directory,
                        `${baseName}-${timestamp}-${suffix}.ts`
                    );
                    suffix += 1;
                    continue;
                }

                throw error;
            }
        }
    }

    private releaseReservedRecordingTargetPath(targetPath: string): void {
        try {
            unlinkSync(targetPath);
        } catch {
            // Ignore cleanup failures; the start error is more useful.
        }
    }

    private createClosedRecordingState(
        recording?: EmbeddedMpvRecordingState
    ): EmbeddedMpvRecordingState {
        return {
            active: false,
            ...(recording?.targetPath
                ? { targetPath: recording.targetPath }
                : {}),
            ...(recording?.error ? { error: recording.error } : {}),
        };
    }

    private sanitizeRecordingFileName(title: string): string {
        const normalized = title
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return (normalized || 'IPTVnator recording').slice(0, 120);
    }

    private formatRecordingTimestamp(date: Date): string {
        const parts = [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
        ].map((part) => String(part).padStart(2, '0'));

        return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
    }

    private isExperimentEnabled(): boolean {
        return ['1', 'true', 'yes', 'on'].includes(
            (process.env[EMBEDDED_MPV_EXPERIMENT_ENV] ?? '')
                .trim()
                .toLowerCase()
        );
    }

    private isEmbeddedMpvEnabled(): boolean {
        return app.isPackaged || this.isExperimentEnabled();
    }

    private assertEmbeddedMpvEnabled(): void {
        if (!this.isEmbeddedMpvEnabled()) {
            throw new Error(
                `Embedded MPV is disabled. Set ${EMBEDDED_MPV_EXPERIMENT_ENV}=1 to enable the local macOS harness, or use a packaged macOS build with the bundled runtime.`
            );
        }
    }

    private getAddon(): NativeEmbeddedMpvAddon {
        if (this.addon) {
            return this.addon;
        }

        if (this.addonLoadError) {
            throw this.addonLoadError;
        }

        const candidatePaths = this.getAddonCandidatePaths();

        const existingCandidatePaths = candidatePaths.filter((candidatePath) =>
            existsSync(candidatePath)
        );

        if (existingCandidatePaths.length === 0) {
            this.addonLoadError = new Error(
                [
                    'Unable to locate the embedded MPV native addon.',
                    ...candidatePaths.map(
                        (candidatePath) => `- ${candidatePath}`
                    ),
                ].join('\n')
            );
            throw this.addonLoadError;
        }

        const loadErrors: string[] = [];
        for (const candidatePath of existingCandidatePaths) {
            try {
                this.addon = this.loadAddonModule(
                    candidatePath
                ) as NativeEmbeddedMpvAddon;
                return this.addon;
            } catch (error) {
                loadErrors.push(
                    `${candidatePath}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        this.addonLoadError = new Error(
            [
                'Unable to load the embedded MPV native addon.',
                ...loadErrors.map((error) => `- ${error}`),
            ].join('\n')
        );
        throw this.addonLoadError;
    }

    private getAddonCandidatePaths(): string[] {
        const localBuildAddonPath = path.resolve(
            process.cwd(),
            'apps/electron-backend/native/build/Release/embedded_mpv.node'
        );
        const distAddonPaths = [
            path.resolve(__dirname, 'native/embedded_mpv.node'),
            path.resolve(__dirname, '../../native/embedded_mpv.node'),
        ];
        const packagedAddonPaths = [
            path.resolve(
                (process as NodeJS.Process & { resourcesPath?: string })
                    .resourcesPath ?? '',
                'app.asar.unpacked',
                'electron-backend',
                'native',
                'embedded_mpv.node'
            ),
            app.getAppPath()
                ? path.join(
                      path.dirname(app.getAppPath()),
                      'app.asar.unpacked',
                      'electron-backend',
                      'native',
                      'embedded_mpv.node'
                  )
                : undefined,
        ];

        return dedupePaths(
            app.isPackaged
                ? [
                      ...packagedAddonPaths,
                      ...distAddonPaths,
                      localBuildAddonPath,
                  ]
                : [
                      localBuildAddonPath,
                      ...distAddonPaths,
                      ...packagedAddonPaths,
                  ]
        );
    }

    private readUnavailableReason(candidatePaths: string[]): string | null {
        for (const candidatePath of candidatePaths) {
            const unavailablePath = path.join(
                path.dirname(candidatePath),
                'embedded-mpv-unavailable.txt'
            );

            if (existsSync(unavailablePath)) {
                return readFileSync(unavailablePath, 'utf8').trim();
            }
        }

        return null;
    }

    private getMissingRuntimeReason(addonPath: string): string | null {
        const nativeDir = path.dirname(addonPath);
        const libMpvPath = path.join(nativeDir, 'lib', 'libmpv.2.dylib');

        if (!existsSync(libMpvPath)) {
            return `Embedded MPV runtime is incomplete. Missing ${libMpvPath}.`;
        }

        return null;
    }
}

export const embeddedMpvNativeService = new EmbeddedMpvNativeService();
