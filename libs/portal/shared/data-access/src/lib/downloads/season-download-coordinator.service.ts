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
    isEpisodeDownloadEligible,
    resolveEpisodeDownload,
    type EpisodeDownloadIdentity,
    type EpisodeDownloadResolution,
} from '@iptvnator/portal/shared/util';
import {
    EPISODE_DOWNLOAD_SUBMISSIONS,
    type EpisodeDownloadCandidate,
    type EpisodeDownloadSubmission,
    type SeasonDownloadResult,
} from './season-download.models';

interface EpisodeDownloadPreflight {
    readonly ready: EpisodeDownloadCandidate[];
    readonly skipped: EpisodeDownloadCandidate[];
    readonly failed: EpisodeDownloadCandidate[];
}

@Injectable({ providedIn: 'root' })
export class SeasonDownloadCoordinator {
    private readonly downloadsService = inject(DownloadsService);
    private readonly logger = createLogger('SeasonDownloadCoordinator');
    private readonly pending = signal<ReadonlySet<string>>(new Set());

    isPending(identity: EpisodeDownloadIdentity): boolean {
        return this.pending().has(createEpisodeDownloadIdentityKey(identity));
    }

    resolveDownload(
        identity: EpisodeDownloadIdentity
    ): EpisodeDownloadResolution<DownloadItem> {
        return resolveEpisodeDownload(
            identity,
            this.downloadsService.downloads()
        );
    }

    isEligible(candidate: EpisodeDownloadCandidate): boolean {
        return (
            this.downloadsService.isAvailable() &&
            this.downloadsService.hasAuthoritativeDownloadList() &&
            this.downloadsService.hasLoadedDownloads() &&
            !this.isPending(candidate.identity) &&
            isEpisodeDownloadEligible(this.resolveDownload(candidate.identity))
        );
    }

    async enqueueOne(
        candidate: EpisodeDownloadCandidate
    ): Promise<EpisodeDownloadSubmission> {
        if (!this.reserve(candidate)) {
            return EPISODE_DOWNLOAD_SUBMISSIONS.Skipped;
        }

        const preflight = await this.preflightCompletedMissing([candidate]);
        if (preflight.ready.length === 0) {
            this.release(candidate.identity);
            return preflight.skipped.length > 0
                ? EPISODE_DOWNLOAD_SUBMISSIONS.Skipped
                : EPISODE_DOWNLOAD_SUBMISSIONS.Failed;
        }

        const submission = await this.submit(candidate);
        if (submission === EPISODE_DOWNLOAD_SUBMISSIONS.Failed) {
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

        const preflight = await this.preflightCompletedMissing(reserved);
        result.skipped += preflight.skipped.length;
        result.failed += preflight.failed.length;
        this.releaseAll(
            [...preflight.skipped, ...preflight.failed].map(
                ({ identity }) => identity
            )
        );

        const refreshPending: EpisodeDownloadIdentity[] = [];
        for (const candidate of preflight.ready) {
            const submission = await this.submit(candidate);
            result[submission] += 1;
            if (submission !== EPISODE_DOWNLOAD_SUBMISSIONS.Failed) {
                refreshPending.push(candidate.identity);
            } else {
                this.release(candidate.identity);
            }
        }

        if (refreshPending.length > 0) {
            try {
                await this.downloadsService.loadDownloads();
            } finally {
                this.releaseAll(refreshPending);
            }
        }

        return result;
    }

    private async preflightCompletedMissing(
        candidates: readonly EpisodeDownloadCandidate[]
    ): Promise<EpisodeDownloadPreflight> {
        if (
            !candidates.some(({ identity }) =>
                this.isCompletedMissing(identity)
            )
        ) {
            return { ready: [...candidates], skipped: [], failed: [] };
        }

        try {
            await this.downloadsService.loadDownloads();
        } catch {
            this.logger.warn('Completed episode file recheck failed');
            return { ready: [], skipped: [], failed: [...candidates] };
        }

        if (
            !this.downloadsService.isAvailable() ||
            !this.downloadsService.hasAuthoritativeDownloadList() ||
            !this.downloadsService.hasLoadedDownloads()
        ) {
            return { ready: [], skipped: [], failed: [...candidates] };
        }

        const ready: EpisodeDownloadCandidate[] = [];
        const skipped: EpisodeDownloadCandidate[] = [];
        for (const candidate of candidates) {
            const resolution = this.resolveDownload(candidate.identity);
            (isEpisodeDownloadEligible(resolution) ? ready : skipped).push(
                candidate
            );
        }
        return { ready, skipped, failed: [] };
    }

    private isCompletedMissing(identity: EpisodeDownloadIdentity): boolean {
        const resolution = this.resolveDownload(identity);
        return (
            resolution.kind === 'match' &&
            resolution.download.status === 'completed' &&
            resolution.download.fileAvailability === 'missing'
        );
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
                    ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyInProgress ||
                result.reason ===
                    ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyDownloaded
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
