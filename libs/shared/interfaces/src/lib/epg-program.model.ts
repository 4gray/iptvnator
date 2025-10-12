export interface EpgProgram {
    start: string;
    stop: string;
    channel: string;
    title: { lang: string; value: string }[];
    desc: { lang: string; value: string }[];
    category: { lang: string; value: string }[];
    date: any[];
    episodeNum: any[];
    previouslyShown: any[];
    subtitles: any[];
    icon: any[];
    rating: { system: string; value: string }[];
    credits: any[];
    audio: any[];
    _attributes: {
        start: string;
        stop: string;
    };
}
