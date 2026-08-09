import type { DownloadStartInput } from '@iptvnator/services';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import type { EpisodeDownloadIdentity } from '@iptvnator/portal/shared/util';

export const EPISODE_DOWNLOAD_SUBMISSIONS = {
    Added: 'added',
    Skipped: 'skipped',
    Failed: 'failed',
} as const;

export type EpisodeDownloadSubmission =
    (typeof EPISODE_DOWNLOAD_SUBMISSIONS)[keyof typeof EPISODE_DOWNLOAD_SUBMISSIONS];

export interface EpisodeDownloadCandidate {
    readonly identity: EpisodeDownloadIdentity;
    readonly prepare: () => Promise<DownloadStartInput>;
}

export interface SeasonEpisodeDownloadAdapter {
    createCandidate(
        episode: XtreamSerieEpisode,
        fallbackSeasonKey: string | undefined
    ): EpisodeDownloadCandidate | null;
}

export interface SeasonDownloadResult {
    readonly added: number;
    readonly skipped: number;
    readonly failed: number;
}
