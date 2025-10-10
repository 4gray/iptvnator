export interface ParsedPlaylist {
    header: {
        attrs: {
            'x-tvg-url': string;
        };
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
    url: string;
    raw: string;
}
