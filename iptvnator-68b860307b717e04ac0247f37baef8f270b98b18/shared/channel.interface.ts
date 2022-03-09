/**
 * Represents channel object
 * TODO: define channel interface in iptv-parser library
 */
export interface Channel {
    id: string;
    url: string;
    name: string;
    group: {
        title: string;
    };
    tvg: {
        id: string;
        name: string;
        language: string;
        country: string;
        url: string;
        logo: string;
        rec: string;
    };
    epgParams?: string;
    timeshift?: string;
    catchup?: {
        type?: string;
        source?: string;
        days?: string;
    };
    http: {
        referrer: string;
        'user-agent': string;
    };
}
