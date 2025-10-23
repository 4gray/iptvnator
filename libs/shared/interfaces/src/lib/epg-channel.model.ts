/**
 * EPG Channel interface compatible with epg-parser v0.4.0
 */
export interface EpgChannel {
    id: string;
    displayName: { lang: string; value: string }[];
    icon: { src: string; width?: number; height?: number }[];
    url: string[];
}
