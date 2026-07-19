export interface ParsedPlaylist {
    header: {
        attrs: Record<string, string | undefined>;
        raw: string;
    };
    items: ParsedPlaylistItem[];
}

export interface ParsedPlaylistItem {
    name: string;
    tvg: {
        id: string;
        name: string;
        url: string;
        logo: string;
        rec: string;
    };
    group: {
        title: string;
    };
    http: {
        referrer: string;
        'user-agent': string;
    };
    /** absent when an #EXTINF entry has no stream URL (e.g. truncated file) */
    url?: string;
    raw: string;
    catchup?: {
        type?: string;
        source?: string;
        days?: string;
    };
    timeshift?: string;
    radio?: string;
}
