import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'iptvnator-imdb-rating-overrides:v1';

export interface ImdbRatingOverride {
    readonly imdbId?: string;
    readonly rating?: number;
    readonly title?: string;
    readonly year?: number;
    readonly updatedAt: string;
}

type StoredOverrides = Record<string, ImdbRatingOverride>;

@Injectable({
    providedIn: 'root',
})
export class ImdbRatingOverridesService {
    private readonly revisionSignal = signal(0);
    readonly revision = this.revisionSignal.asReadonly();

    getOverride(key: string | null | undefined): ImdbRatingOverride | null {
        if (!key) {
            return null;
        }

        return this.readAll()[key] ?? null;
    }

    setOverride(
        key: string,
        override: Omit<ImdbRatingOverride, 'updatedAt'>
    ): ImdbRatingOverride {
        const normalized = this.normalizeOverride(override);
        const overrides = this.readAll();
        const stored: ImdbRatingOverride = {
            ...normalized,
            updatedAt: new Date().toISOString(),
        };

        overrides[key] = stored;
        this.writeAll(overrides);
        this.bumpRevision();

        return stored;
    }

    clearOverride(key: string | null | undefined): void {
        if (!key) {
            return;
        }

        const overrides = this.readAll();
        if (!overrides[key]) {
            return;
        }

        delete overrides[key];
        this.writeAll(overrides);
        this.bumpRevision();
    }

    clearAll(): void {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
        }

        this.bumpRevision();
    }

    private normalizeOverride(
        override: Omit<ImdbRatingOverride, 'updatedAt'>
    ): Omit<ImdbRatingOverride, 'updatedAt'> {
        const imdbId = this.normalizeImdbId(override.imdbId);
        const title = override.title?.trim() || undefined;
        const year =
            typeof override.year === 'number' &&
            Number.isFinite(override.year) &&
            override.year > 1800
                ? Math.round(override.year)
                : undefined;
        const rating =
            typeof override.rating === 'number' &&
            Number.isFinite(override.rating)
                ? Math.min(10, Math.max(0, override.rating))
                : undefined;

        return {
            imdbId,
            rating,
            title,
            year,
        };
    }

    private normalizeImdbId(value: string | undefined): string | undefined {
        const normalized = value?.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }

        const match = normalized.match(/tt\d{5,12}/);
        return match?.[0] ?? normalized;
    }

    private readAll(): StoredOverrides {
        if (typeof localStorage === 'undefined') {
            return {};
        }

        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? (JSON.parse(raw) as StoredOverrides) : {};
        } catch {
            return {};
        }
    }

    private writeAll(overrides: StoredOverrides): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
        } catch {
            // Storage quota/privacy mode should not block the details page.
        }
    }

    private bumpRevision(): void {
        this.revisionSignal.update((value) => value + 1);
    }
}
