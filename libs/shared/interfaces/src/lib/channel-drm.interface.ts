/**
 * DRM configuration extracted from `#KODIPROP:inputstream.adaptive.*` lines of
 * an M3U playlist entry. Only ClearKey is playable in-app; other license types
 * are preserved so playback can surface a meaningful DRM diagnostic instead of
 * failing silently.
 */
export interface ChannelDrmClearKeys {
    /** Key id (32 lowercase hex chars) mapped to its key (32 lowercase hex chars). */
    [kidHex: string]: string;
}

export interface ChannelDrm {
    /** Normalized license type, e.g. `clearkey` or `com.widevine.alpha`. */
    licenseType: string;
    /** True only for ClearKey entries with at least one successfully parsed key. */
    supported: boolean;
    clearKeys?: ChannelDrmClearKeys;
}
