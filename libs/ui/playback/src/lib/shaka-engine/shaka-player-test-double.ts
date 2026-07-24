import type {
    ShakaAudioTrackLike,
    ShakaModuleLike,
    ShakaModuleLoader,
    ShakaPlayerLike,
    ShakaTextTrackLike,
} from './shaka-module.types';

/**
 * Jest-free Shaka test double shared by the shaka-engine and ArtPlayer specs.
 * Mirrors the {@link ShakaPlayerLike} surface, including the real Shaka
 * semantic that `destroy()` interrupts an in-flight `load()` with
 * `LOAD_INTERRUPTED` (7000).
 */

type Listener = (event: Event) => void;

const LOAD_INTERRUPTED_ERROR = {
    severity: 2,
    category: 7,
    code: 7000,
} as const;

export class FakeShakaPlayer implements ShakaPlayerLike {
    readonly configureCalls: Record<string, unknown>[] = [];
    readonly selectTextTrackCalls: unknown[] = [];
    readonly selectedAudioTracks: ShakaAudioTrackLike[] = [];
    readonly listeners = new Map<string, Set<Listener>>();
    attachedTo: HTMLMediaElement | null = null;
    loadedUrls: string[] = [];
    destroyCount = 0;
    audioTracks: ShakaAudioTrackLike[] = [];
    textTracks: ShakaTextTrackLike[] = [];
    /** When true, the next `load()` stays pending until `destroy()`. */
    stallNextLoad = false;
    loadResult: Promise<unknown> = Promise.resolve();
    private pendingLoadReject: ((error: unknown) => void) | null = null;

    attach(mediaElement: HTMLMediaElement): Promise<unknown> {
        this.attachedTo = mediaElement;
        return Promise.resolve();
    }

    configure(config: Record<string, unknown>): boolean {
        this.configureCalls.push(config);
        return true;
    }

    load(assetUri: string): Promise<unknown> {
        this.loadedUrls.push(assetUri);
        if (this.stallNextLoad) {
            this.stallNextLoad = false;
            return new Promise((_resolve, reject) => {
                this.pendingLoadReject = reject;
            });
        }
        return this.loadResult;
    }

    destroy(): Promise<unknown> {
        this.destroyCount += 1;
        this.pendingLoadReject?.(LOAD_INTERRUPTED_ERROR);
        this.pendingLoadReject = null;
        return Promise.resolve();
    }

    addEventListener(type: string, listener: Listener): void {
        const set = this.listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: string, detail?: unknown): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener({ type, detail } as unknown as Event);
        }
    }

    getAudioTracks(): ShakaAudioTrackLike[] {
        return this.audioTracks;
    }

    selectAudioTrack(track: ShakaAudioTrackLike): void {
        this.selectedAudioTracks.push(track);
    }

    getTextTracks(): ShakaTextTrackLike[] {
        return this.textTracks;
    }

    selectTextTrack(track: ShakaTextTrackLike | null): void {
        this.selectTextTrackCalls.push(track);
        for (const candidate of this.textTracks) {
            candidate.active = candidate === track;
        }
    }

    isLive(): boolean {
        return false;
    }
}

export interface FakeShakaEnvironment {
    /** Every player the fake module has constructed, in creation order. */
    readonly instances: FakeShakaPlayer[];
    readonly loader: ShakaModuleLoader;
    readonly module: ShakaModuleLike;
    loaderCalls: number;
    installAllCalls: number;
    browserSupported: boolean;
}

export function createFakeShakaEnvironment(options?: {
    onCreate?: (player: FakeShakaPlayer, index: number) => void;
}): FakeShakaEnvironment {
    const instances: FakeShakaPlayer[] = [];

    const environment: FakeShakaEnvironment = {
        instances,
        loaderCalls: 0,
        installAllCalls: 0,
        browserSupported: true,
        module: undefined as unknown as ShakaModuleLike,
        loader: undefined as unknown as ShakaModuleLoader,
    };

    const playerConstructor = function (this: unknown) {
        const player = new FakeShakaPlayer();
        options?.onCreate?.(player, instances.length);
        instances.push(player);
        return player;
    } as unknown as ShakaModuleLike['Player'];
    (
        playerConstructor as unknown as { isBrowserSupported: () => boolean }
    ).isBrowserSupported = () => environment.browserSupported;

    const module: ShakaModuleLike = {
        Player: playerConstructor,
        polyfill: {
            installAll: () => {
                environment.installAllCalls += 1;
            },
        },
    };

    (environment as { module: ShakaModuleLike }).module = module;
    (environment as { loader: ShakaModuleLoader }).loader = () => {
        environment.loaderCalls += 1;
        return Promise.resolve(module);
    };

    return environment;
}

/** Drains chained microtasks so queued session operations settle. */
export async function flushShakaMicrotasks(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
}
