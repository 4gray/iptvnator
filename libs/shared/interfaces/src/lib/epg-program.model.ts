/**
 * EPG Program interface - flat structure matching database storage
 */
export interface EpgProgram {
    start: string; // ISO string
    stop: string; // ISO string
    channel: string;
    title: string;
    desc: string | null;
    category: string | null;
    date?: string;
    episodeNum?: string | null;
    iconUrl?: string | null;
    rating?: string | null;
}
