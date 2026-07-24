/**
 * Minimal structural typings for the lazily imported `shaka-player` module.
 *
 * The vendor package ships clutz-generated global namespace typings that are
 * awkward to consume from an ESM library. These interfaces cover exactly the
 * surface the app uses and double as the seam for unit-test fakes: the session
 * accepts any {@link ShakaModuleLoader}, so specs never touch the real module.
 */

export interface ShakaAudioTrackLike {
    active: boolean;
    language: string;
    label: string | null;
    roles: string[];
}

export interface ShakaTextTrackLike {
    id: number;
    active: boolean;
    language: string;
    label: string | null;
    kind: string | null;
}

export interface ShakaErrorLike {
    severity: number;
    category: number;
    code: number;
    message?: string;
    data?: unknown[];
}

export interface ShakaPlayerLike {
    attach(mediaElement: HTMLMediaElement): Promise<unknown>;
    configure(config: Record<string, unknown>): boolean;
    load(assetUri: string): Promise<unknown>;
    destroy(): Promise<unknown>;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
    getAudioTracks(): ShakaAudioTrackLike[];
    selectAudioTrack(track: ShakaAudioTrackLike): void;
    getTextTracks(): ShakaTextTrackLike[];
    /**
     * Shaka 5 visibility model: selecting a track shows it, `null` unloads
     * the active track (subtitles off). There is no separate visibility API.
     */
    selectTextTrack(track: ShakaTextTrackLike | null): void;
    isLive(): boolean;
}

export interface ShakaModuleLike {
    Player: {
        new (): ShakaPlayerLike;
        isBrowserSupported(): boolean;
    };
    polyfill: {
        installAll(): void;
    };
}

export type ShakaModuleLoader = () => Promise<ShakaModuleLike>;

/**
 * Default production loader. The dynamic import keeps shaka-player (~267 KB
 * gzip) out of the main bundle until the first `.mpd` stream starts.
 */
export const loadShakaModule: ShakaModuleLoader = async () => {
    const module = (await import('shaka-player')) as unknown as
        | { default?: ShakaModuleLike }
        | ShakaModuleLike;
    return (
        ((module as { default?: ShakaModuleLike }).default ??
            module) as ShakaModuleLike
    );
};
