import { extname } from 'node:path';

// OS-open is allowed only for media, including rows saved by older releases.
const MEDIA_EXTENSIONS = new Set([
    '3g2',
    '3gp',
    'aac',
    'aiff',
    'alac',
    'ape',
    'asf',
    'avi',
    'divx',
    'flac',
    'flv',
    'm2ts',
    'm3u',
    'm3u8',
    'm4a',
    'm4s',
    'm4v',
    'mkv',
    'mov',
    'mp3',
    'mp4',
    'mpd',
    'mpeg',
    'mpg',
    'mts',
    'oga',
    'ogg',
    'ogv',
    'opus',
    'rm',
    'rmvb',
    'ts',
    'vob',
    'wav',
    'webm',
    'wma',
    'wmv',
]);

export function isDownloadMediaFile(filePath: string): boolean {
    return MEDIA_EXTENSIONS.has(extname(filePath).slice(1).toLowerCase());
}

export function assertDownloadMediaFile(filePath: string): void {
    if (!isDownloadMediaFile(filePath)) {
        throw new Error('Unsupported download media type');
    }
}
