export interface MediaStreamMetadata {
    available: boolean;
    qualityLabel?: string;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioLanguages: string[];
    audioCodecs: string[];
    subtitleLanguages: string[];
    subtitleCodecs: string[];
    source?: 'xtream' | 'ffprobe' | 'derived';
    reason?: string;
}

export interface MediaStreamMetadataProbeRequest {
    url: string;
    headers?: Record<string, string>;
}
