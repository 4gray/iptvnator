import type videoJs from 'video.js';

export type VideoPlayerSource = {
    src: string;
    type?: string;
};

export type VideoPlayerOptions = Record<string, unknown> & {
    autoplay?: boolean;
    controls?: boolean;
    isLive?: boolean;
    reloadToken?: number;
    sources?: VideoPlayerSource[];
    spatialNavigation?: Record<string, unknown> & {
        enabled?: boolean;
    };
    userActions?: Record<string, unknown> & {
        click?: boolean;
        doubleClick?: boolean;
        hotkeys?: boolean;
    };
};

export type VideoJsAudioTrack = {
    label?: string;
    language?: string;
    enabled?: boolean;
    kind?: string;
};

export type VideoJsTextTrack = {
    label?: string;
    language?: string;
    kind?: string;
    mode: TextTrackMode;
};

export type VideoJsTrackList<TTrack> = {
    length: number;
    [index: number]: TTrack;
    addEventListener?: (
        type: string,
        listener: EventListenerOrEventListenerObject
    ) => void;
    removeEventListener?: (
        type: string,
        listener: EventListenerOrEventListenerObject
    ) => void;
};

export type VideoJsAudioTrackList = VideoJsTrackList<VideoJsAudioTrack>;
export type VideoJsTextTrackList = VideoJsTrackList<VideoJsTextTrack>;

export type VideoJsTech = {
    el?: () => Element | null;
    vhs?: {
        playlists?: {
            main?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
            master?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
        };
    };
};

export type VideoJsControlChild = {
    getChild?: (name: string) => VideoJsControlChild | null;
    addChild?: (
        name: string,
        options?: Record<string, unknown>
    ) => VideoJsControlChild | null;
    show?: () => void;
    update?: () => void;
};

export type VideoJsPlayer = Omit<
    ReturnType<typeof videoJs>,
    'audioTracks' | 'textTracks' | 'tech' | 'getChild' | 'error'
> & {
    qualitySelectorHls?: (options?: {
        displayCurrentQuality?: boolean;
    }) => void;
    aspectRatioPanel?: () => void;
    audioTracks: () => VideoJsAudioTrackList | null;
    textTracks: () => VideoJsTextTrackList | null;
    tech: (options?: unknown) => VideoJsTech | null;
    getChild: (name: string) => VideoJsControlChild | null;
    error: () => { code?: number; message?: string } | null;
};

export function getVideoJsTechVideo(
    player: Pick<VideoJsPlayer, 'tech'>
): HTMLVideoElement | null {
    try {
        const element = player.tech({ IWillNotUseThisInPlugins: true })?.el?.();
        return element instanceof HTMLVideoElement ? element : null;
    } catch {
        return null;
    }
}
