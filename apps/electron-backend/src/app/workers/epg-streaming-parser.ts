import { SaxesParser, SaxesTagPlain } from 'saxes';

export interface ParsedTextValue {
    lang: string;
    value: string;
}

export interface ParsedIcon {
    src: string;
    width?: number;
    height?: number;
}

export interface ParsedRating {
    system: string;
    value: string;
}

export interface ParsedEpisodeNum {
    system: string;
    value: string;
}

export interface ParsedChannel {
    id: string;
    displayName: ParsedTextValue[];
    icon: ParsedIcon[];
    url: string[];
}

export interface ParsedProgram {
    start: string;
    stop: string;
    channel: string;
    title: ParsedTextValue[];
    desc: ParsedTextValue[];
    category: ParsedTextValue[];
    date: string;
    episodeNum: ParsedEpisodeNum[];
    icon: ParsedIcon[];
    rating: ParsedRating[];
}

/**
 * Parse XMLTV datetime format to ISO string
 * Format: YYYYMMDDHHmmss +HHMM or YYYYMMDDHHmmss
 */
export function parseXmltvDate(dateStr: string): string {
    if (!dateStr) return '';

    const match = dateStr.match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/
    );

    if (!match) return dateStr;

    const [, year, month, day, hour, minute, second, tz] = match;

    let isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

    if (tz) {
        isoString += `${tz.slice(0, 3)}:${tz.slice(3)}`;
    } else {
        isoString += 'Z';
    }

    return isoString;
}

/**
 * Streaming EPG parser using SAX
 */
export class StreamingEpgParser {
    private parser: SaxesParser;
    private channels: ParsedChannel[] = [];
    private programs: ParsedProgram[] = [];
    private totalChannels = 0;
    private totalPrograms = 0;

    // Current element being parsed
    private currentChannel: Partial<ParsedChannel> | null = null;
    private currentProgram: Partial<ParsedProgram> | null = null;
    private currentTextContent = '';
    private currentLang = '';

    // For nested elements
    private elementStack: string[] = [];

    constructor(
        private readonly onChannelsBatch: (channels: ParsedChannel[]) => void,
        private readonly onProgramsBatch: (programs: ParsedProgram[]) => void,
        private readonly onProgress: (channels: number, programs: number) => void,
        private readonly channelBatchSize = 100,
        private readonly programBatchSize = 1000
    ) {
        this.parser = new SaxesParser();
        this.setupParser();
    }

    private setupParser(): void {
        this.parser.on('opentag', (tag: SaxesTagPlain) => {
            this.elementStack.push(tag.name);
            this.currentTextContent = '';

            switch (tag.name) {
                case 'channel':
                    this.currentChannel = {
                        id: (tag.attributes['id'] as string) || '',
                        displayName: [],
                        icon: [],
                        url: [],
                    };
                    break;

                case 'programme':
                    // XMLTV feeds typically emit all <channel> entries before
                    // the first <programme>. Flush any pending channel batch
                    // so downstream program consumers can resolve late-channel
                    // IDs immediately instead of dropping the first rows.
                    this.flushChannels();
                    this.currentProgram = {
                        start: parseXmltvDate(
                            (tag.attributes['start'] as string) || ''
                        ),
                        stop: parseXmltvDate(
                            (tag.attributes['stop'] as string) || ''
                        ),
                        channel: (tag.attributes['channel'] as string) || '',
                        title: [],
                        desc: [],
                        category: [],
                        date: '',
                        episodeNum: [],
                        icon: [],
                        rating: [],
                    };
                    break;

                case 'icon':
                    if (this.currentChannel) {
                        this.currentChannel.icon!.push({
                            src: (tag.attributes['src'] as string) || '',
                            width: tag.attributes['width']
                                ? parseInt(tag.attributes['width'] as string)
                                : undefined,
                            height: tag.attributes['height']
                                ? parseInt(tag.attributes['height'] as string)
                                : undefined,
                        });
                    } else if (this.currentProgram) {
                        this.currentProgram.icon!.push({
                            src: (tag.attributes['src'] as string) || '',
                            width: tag.attributes['width']
                                ? parseInt(tag.attributes['width'] as string)
                                : undefined,
                            height: tag.attributes['height']
                                ? parseInt(tag.attributes['height'] as string)
                                : undefined,
                        });
                    }
                    break;

                case 'display-name':
                case 'title':
                case 'desc':
                case 'category':
                    this.currentLang = (tag.attributes['lang'] as string) || '';
                    break;

                case 'rating':
                    if (this.currentProgram) {
                        const system =
                            (tag.attributes['system'] as string) || '';
                        this.currentProgram.rating!.push({ system, value: '' });
                    }
                    break;

                case 'episode-num':
                    if (this.currentProgram) {
                        const system =
                            (tag.attributes['system'] as string) || '';
                        this.currentProgram.episodeNum!.push({
                            system,
                            value: '',
                        });
                    }
                    break;
            }
        });

        this.parser.on('text', (text: string) => {
            this.currentTextContent += text;
        });

        this.parser.on('closetag', (tag: SaxesTagPlain) => {
            const text = this.currentTextContent.trim();

            if (this.currentChannel) {
                switch (tag.name) {
                    case 'display-name':
                        this.currentChannel.displayName!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'url':
                        if (text) this.currentChannel.url!.push(text);
                        break;
                    case 'channel':
                        this.channels.push(this.currentChannel as ParsedChannel);
                        this.totalChannels++;
                        this.currentChannel = null;

                        if (this.channels.length >= this.channelBatchSize) {
                            this.flushChannels();
                        }
                        break;
                }
            }

            if (this.currentProgram) {
                switch (tag.name) {
                    case 'title':
                        this.currentProgram.title!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'desc':
                        this.currentProgram.desc!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'category':
                        this.currentProgram.category!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'date':
                        this.currentProgram.date = text;
                        break;
                    case 'value':
                        if (
                            this.elementStack.includes('rating') &&
                            this.currentProgram.rating!.length > 0
                        ) {
                            this.currentProgram.rating![
                                this.currentProgram.rating!.length - 1
                            ].value = text;
                        }
                        break;
                    case 'episode-num':
                        if (this.currentProgram.episodeNum!.length > 0) {
                            this.currentProgram.episodeNum![
                                this.currentProgram.episodeNum!.length - 1
                            ].value = text;
                        }
                        break;
                    case 'programme':
                        this.programs.push(this.currentProgram as ParsedProgram);
                        this.totalPrograms++;

                        if (this.programs.length >= this.programBatchSize) {
                            this.flushChannels();
                            this.flushPrograms();
                        }
                        this.currentProgram = null;
                        break;
                }
            }

            this.elementStack.pop();
            this.currentTextContent = '';
        });
    }

    private flushChannels(): void {
        if (this.channels.length > 0) {
            this.onChannelsBatch([...this.channels]);
            this.channels = [];
            this.onProgress(this.totalChannels, this.totalPrograms);
        }
    }

    private flushPrograms(): void {
        if (this.programs.length > 0) {
            this.onProgramsBatch([...this.programs]);
            this.programs = [];
            this.onProgress(this.totalChannels, this.totalPrograms);
        }
    }

    write(chunk: string): void {
        this.parser.write(chunk);
    }

    finish(): { totalChannels: number; totalPrograms: number } {
        this.parser.close();
        this.flushChannels();
        this.flushPrograms();

        return {
            totalChannels: this.totalChannels,
            totalPrograms: this.totalPrograms,
        };
    }
}
