import { computed, inject, Injectable, signal } from '@angular/core';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EmbeddedMpvSupport } from '@iptvnator/shared/interfaces';

/**
 * Probes the desktop backend for embedded MPV support so the playback
 * section can hide options the current build cannot deliver.
 */
@Injectable()
export class SettingsEmbeddedMpvFacade {
    private readonly runtime = inject(RuntimeCapabilitiesService);

    readonly support = signal<EmbeddedMpvSupport | null>(null);

    readonly supported = computed(
        () => this.runtime.isElectron && !!this.support()?.supported
    );

    readonly frameCopyAvailable = computed(
        () => this.runtime.isElectron && !!this.support()?.frameCopyAvailable
    );

    readonly frameCopyActive = computed(
        () => this.support()?.engine === 'frame-copy'
    );

    async load(): Promise<void> {
        if (!this.runtime.isElectron) {
            this.support.set({
                supported: false,
                platform: 'web',
                reason: 'Embedded MPV requires the Electron desktop build.',
            });
            return;
        }

        if (!window.electron?.getEmbeddedMpvSupport) {
            this.support.set({
                supported: false,
                platform: window.electron.platform,
                reason: 'Embedded MPV support is not available in this build.',
            });
            return;
        }

        try {
            this.support.set(await window.electron.getEmbeddedMpvSupport());
        } catch (error) {
            this.support.set({
                supported: false,
                platform: window.electron.platform,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Opens the native folder picker for MPV recordings.
     * @returns the selected folder, or null when the user cancelled or the
     * desktop bridge cannot show the dialog
     */
    async selectRecordingFolder(): Promise<string | null> {
        if (
            !this.runtime.isElectron ||
            !window.electron?.selectEmbeddedMpvRecordingFolder
        ) {
            return null;
        }

        return (
            (await window.electron.selectEmbeddedMpvRecordingFolder()) ?? null
        );
    }
}
