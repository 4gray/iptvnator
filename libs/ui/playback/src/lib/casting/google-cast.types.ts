export interface GoogleCastSession {
    loadMedia(request: unknown): Promise<unknown>;
}

export interface GoogleCastContext {
    getCurrentSession(): GoogleCastSession | null;
    requestSession(): Promise<unknown>;
    setOptions(options: {
        receiverApplicationId: string;
        autoJoinPolicy: string;
    }): void;
}

export interface GoogleCastRuntime {
    cast: {
        framework: {
            AutoJoinPolicy: {
                ORIGIN_SCOPED: string;
            };
            CastContext: {
                getInstance(): GoogleCastContext;
            };
        };
    };
    chrome: {
        cast: {
            media: {
                DEFAULT_MEDIA_RECEIVER_APP_ID: string;
                GenericMediaMetadata: new () => {
                    title?: string;
                    images?: Array<{ url: string }>;
                };
                LoadRequest: new (mediaInfo: unknown) => unknown;
                MediaInfo: new (
                    contentId: string,
                    contentType: string
                ) => {
                    metadata?: unknown;
                    streamType?: string;
                };
                StreamType: {
                    BUFFERED: string;
                    LIVE: string;
                };
            };
        };
    };
}

export type GoogleCastWindow = Window &
    Partial<GoogleCastRuntime> & {
        __onGCastApiAvailable?: (available: boolean) => void;
    };
