import { PlayerContentInfo } from './portal-playback.interface';

export type ExternalPlayerName = 'mpv' | 'vlc';

export type ExternalPlayerSessionStatus =
    | 'launching'
    | 'opened'
    | 'playing'
    | 'error'
    | 'closed';

export interface ExternalPlayerSession {
    id: string;
    player: ExternalPlayerName;
    status: ExternalPlayerSessionStatus;
    title: string;
    thumbnail?: string | null;
    streamUrl: string;
    contentInfo?: PlayerContentInfo;
    startedAt: string;
    updatedAt: string;
    error?: string;
    canClose: boolean;
}
