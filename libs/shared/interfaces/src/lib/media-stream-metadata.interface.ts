export interface MediaStreamMetadata {
    available: boolean;
    qualityLabel?: string;
    qualityLabels?: string[];
    width?: number;
    widths?: number[];
    height?: number;
    heights?: number[];
    videoCodec?: string;
    videoCodecs?: string[];
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
