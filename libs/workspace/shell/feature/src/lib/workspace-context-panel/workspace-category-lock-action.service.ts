import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ParentalLockService } from '@iptvnator/services';
import {
    toParentalLockStalkerCategoryType,
    toParentalLockXtreamCategoryType,
} from '@iptvnator/shared/interfaces';

export interface CategoryLockTarget {
    readonly provider: 'xtreams' | 'stalker';
    readonly playlistId: string;
    readonly section: string;
    readonly item: {
        readonly category_id?: string | number;
        readonly xtream_id?: number;
        readonly id?: string | number;
    };
}

/**
 * The single-category lock toggle behind the category rail's right-click
 * menu. Same persistence as the "Manage categories" dialog (the lock store
 * is the source of truth), same PIN gate, same failure snackbar — only the
 * entry point differs.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCategoryLockActionService {
    private readonly parentalLock = inject(ParentalLockService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    /** The menu exists only while the feature is on. */
    readonly enabled = this.parentalLock.enabled;

    /**
     * Xtream rows carry the provider id as `xtream_id` (Electron) or as
     * `category_id` (PWA); Stalker genres are keyed by `category_id`.
     */
    isLocked(target: CategoryLockTarget): boolean {
        if (target.provider === 'xtreams') {
            const type = toParentalLockXtreamCategoryType(target.section);
            const id = this.xtreamProviderId(target);
            return (
                !!type &&
                id !== null &&
                this.parentalLock
                    .lockedXtreamIds(target.playlistId, type)
                    .includes(id)
            );
        }
        const type = toParentalLockStalkerCategoryType(target.section);
        const id = this.stalkerId(target);
        return (
            !!type &&
            id !== null &&
            this.parentalLock
                .lockedStalkerIds(target.playlistId, type)
                .includes(id)
        );
    }

    /** Locks or unlocks one category; false when refused or failed. */
    async setLocked(
        target: CategoryLockTarget,
        locked: boolean
    ): Promise<boolean> {
        if (!(await this.parentalLock.requestUnlock())) {
            return false;
        }
        const saved = await this.persist(target, locked);
        if (!saved) {
            this.snackBar.open(
                this.translate.instant('PARENTAL_LOCK.SAVE_FAILED'),
                this.translate.instant('CLOSE'),
                { duration: 5000 }
            );
        }
        return saved;
    }

    private persist(
        target: CategoryLockTarget,
        locked: boolean
    ): Promise<boolean> {
        if (target.provider === 'xtreams') {
            const type = toParentalLockXtreamCategoryType(target.section);
            const id = this.xtreamProviderId(target);
            if (!type || id === null) {
                return Promise.resolve(false);
            }
            const current = this.parentalLock.lockedXtreamIds(
                target.playlistId,
                type
            );
            return this.parentalLock.setXtreamLocks(
                target.playlistId,
                type,
                locked
                    ? [...current, id]
                    : current.filter((entry) => entry !== id)
            );
        }
        const type = toParentalLockStalkerCategoryType(target.section);
        const id = this.stalkerId(target);
        if (!type || id === null) {
            return Promise.resolve(false);
        }
        const current = this.parentalLock.lockedStalkerIds(
            target.playlistId,
            type
        );
        return this.parentalLock.setStalkerLocks(
            target.playlistId,
            type,
            locked ? [...current, id] : current.filter((entry) => entry !== id)
        );
    }

    private xtreamProviderId(target: CategoryLockTarget): number | null {
        const id = Number(target.item.xtream_id ?? target.item.category_id);
        return Number.isFinite(id) ? id : null;
    }

    private stalkerId(target: CategoryLockTarget): string | null {
        const raw = target.item.category_id ?? target.item.id;
        if (raw === undefined || raw === null || String(raw) === '*') {
            return null;
        }
        return String(raw);
    }
}
