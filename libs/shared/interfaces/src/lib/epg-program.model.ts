/**
 * EPG Program interface compatible with epg-parser v0.4.0
 * Note: start/stop are ISO strings, date is string instead of array
 */
export interface EpgProgram {
    start: string; // ISO string
    stop: string; // ISO string
    channel: string;
    title: { lang: string; value: string }[];
    desc: { lang: string; value: string }[];
    category: { lang: string; value: string }[];
    date: string; // Changed from array to string in v0.4.0
    episodeNum: any[];
    previouslyShown: any[];
    subtitles: any[];
    icon: { src: string; width?: number; height?: number }[];
    rating: { system: string; value: string }[];
    credits: any[];
    audio: any[];
}
