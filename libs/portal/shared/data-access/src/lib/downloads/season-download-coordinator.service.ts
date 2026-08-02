import { inject, Injectable, signal } from '@angular/core';
import {
    DownloadsService,
    type DownloadItem,
    type DownloadStartInput,
} from '@iptvnator/services';
import { ELECTRON_BRIDGE_DOWNLOAD_START_REASONS } from '@iptvnator/shared/interfaces';
import {
    createEpisodeDownloadIdentityKey,
    createLogger,
    findEpisodeDownload,
    isEpisodeDownloadEligible,
    type EpisodeDownloadIdentity,
} from '@iptvnator/portal/shared/util';
import {
    EPISODE_DOWNLOAD_SUBMISSIONS,
    type EpisodeDownloadCandidate,
    type EpisodeDownloadSubmission,
    type SeasonDownloadResult,
} from './season-download.models';

@Injectable({ providedIn: 'root' })
export class SeasonDownloadCoordinator {
    private readonly downloadsService = inject(DownloadsService);
    private readonly logger = createLogger('SeasonDownloadCoordinator');
    private readonly pending = signal<ReadonlySet<string>>(new Set());

    isPending(identity: EpisodeDownloadIdentity): boolean {
        return this.pending().has(createEpisodeDownloadIdentityKey(identity));
    }

    findDownload(identity: EpisodeDownloadIdentity): DownloadItem | undefined {
        return findEpisodeDownload(identity, this.downloadsService.downloads());
    }

    isEligible(candidate: EpisodeDownloadCandidate): boolean {
        return (
            this.downloadsService.isAvailable() &&
            this.downloadsService.hasLoadedDownloads() &&
            !this.isPending(candidate.identity) &&
            isEpisodeDownloadEligible(this.findDownload(candidate.identity))
        );
    }

    async enqueueOne(
        candidate: EpisodeDownloadCandidate
    ): Promise<EpisodeDownloadSubmission> {
        if (!this.reserve(candidate)) {
            return EPISODE_DOWNLOAD_SUBMISSIONS.Skipped;
        }

        const submission = await this.submit(candidate);
        if (submission !== EPISODE_DOWNLOAD_SUBMISSIONS.Added) {
            this.release(candidate.identity);
            return submission;
        }

        try {
            await this.downloadsService.loadDownloads();
            return submission;
        } finally {
            this.release(candidate.identity);
        }
    }

    async enqueueSeason(
        candidates: readonly (EpisodeDownloadCandidate | null)[]
    ): Promise<SeasonDownloadResult> {
        const result = { added: 0, skipped: 0, failed: 0 };
        const reserved: EpisodeDownloadCandidate[] = [];

        for (const candidate of candidates) {
            if (!candidate || !this.reserve(candidate)) {
                result.skipped += 1;
                continue;
            }
            reserved.push(candidate);
        }

        const accepted: EpisodeDownloadIdentity[] = [];
        for (const candidate of reserved) {
            const submission = await this.submit(candidate);
            result[submission] += 1;
            if (submission === EPISODE_DOWNLOAD_SUBMISSIONS.Added) {
                accepted.push(candidate.identity);
            } else {
                this.release(candidate.identity);
            }
        }

        if (accepted.length > 0) {
            try {
                await this.downloadsService.loadDownloads();
            } finally {
                this.releaseAll(accepted);
            }
        }

        return result;
    }

    private reserve(candidate: EpisodeDownloadCandidate): boolean {
        if (!this.isEligible(candidate)) {
            return false;
        }

        const key = createEpisodeDownloadIdentityKey(candidate.identity);
        const next = new Set(this.pending());
        next.add(key);
        this.pending.set(next);
        return true;
    }

    private async submit(
        candidate: EpisodeDownloadCandidate
    ): Promise<EpisodeDownloadSubmission> {
        try {
            const request: DownloadStartInput = await candidate.prepare();
            const result = await this.downloadsService.startDownload(request);
            if (result.success) {
                return EPISODE_DOWNLOAD_SUBMISSIONS.Added;
            }
            if (
                result.reason ===
                ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyInProgress
            ) {
                return EPISODE_DOWNLOAD_SUBMISSIONS.Skipped;
            }
            return EPISODE_DOWNLOAD_SUBMISSIONS.Failed;
        } catch {
            this.logger.warn('Episode download submission failed');
            return EPISODE_DOWNLOAD_SUBMISSIONS.Failed;
        }
    }

    private release(identity: EpisodeDownloadIdentity): void {
        const key = createEpisodeDownloadIdentityKey(identity);
        const next = new Set(this.pending());
        next.delete(key);
        this.pending.set(next);
    }

    private releaseAll(identities: readonly EpisodeDownloadIdentity[]): void {
        const next = new Set(this.pending());
        for (const identity of identities) {
            next.delete(createEpisodeDownloadIdentityKey(identity));
        }
        this.pending.set(next);
    }
}
