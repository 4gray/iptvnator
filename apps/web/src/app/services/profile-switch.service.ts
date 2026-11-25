import { EnvironmentInjector, Injectable, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistsService } from '@iptvnator/services';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
import {
    activePersonalScope,
    setActivePersonalScope,
} from '@iptvnator/services/profiles';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { ActivitySyncRuntime } from './activity-sync-runtime';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';
import { refreshFavoriteViews } from './favorites-view-refresh';
import { HistorySyncRuntime } from './history-sync-runtime';
import { ProfilesRuntime } from './profiles-runtime';

const noop = (): void => undefined;

/**
 * Moves this device's personal state from one household profile to another:
 * drains what the old profile still owes the server, rescopes, and makes
 * every reader that outlives the switch (clients, lists, caches) start over.
 */
@Injectable({ providedIn: 'root' })
export class ProfileSwitchService {
    private readonly injector = inject(EnvironmentInjector);
    private readonly profiles = inject(ProfilesRuntime);
    private queue: Promise<void> = Promise.resolve();
    /** The newest scope asked for; an older switch still draining gives way to it. */
    private target: PersonalScope = activePersonalScope();

    constructor() {
        // Later changes of the active profile (picker, switcher, a deleted profile).
        effect(() => void this.apply(this.profiles.scope()));
    }

    /** Runs switches one at a time; resolves once this device is on `scope`. */
    apply(scope: PersonalScope): Promise<void> {
        this.target = scope;
        this.queue = this.queue.catch(noop).then(() => this.switchTo(scope));
        return this.queue;
    }

    private async switchTo(scope: PersonalScope): Promise<void> {
        if (activePersonalScope() === scope) return;
        const activity = this.injector.get(ActivitySyncRuntime);
        const favorites = this.injector.get(FavoritesSyncRuntime);
        const history = this.injector.get(HistorySyncRuntime);
        await this.drain(activity, favorites, history);
        // The choice moved on while this device drained (start-up gave up and
        // fell back to Default): the newer apply owns the switch.
        if (this.target !== scope) return;
        setActivePersonalScope(scope);
        // Readers that outlive the switch drop the old profile's data now.
        window.dispatchEvent(new Event('iptvnator-profile-switched'));
        // A scope change rebuilds each client on its next use; list afresh.
        await Promise.all([
            activity.refresh().catch(noop),
            favorites.refresh().catch(noop),
            history.refresh().catch(noop),
        ]);
        await refreshFavoriteViews(
            this.injector.get(PlaylistsService),
            (playlist) => favorites.project(playlist),
            this.injector.get(Router),
            this.injector.get(Store)
        ).catch(noop);
        window.dispatchEvent(new Event('iptvnator-history-changed'));
        announceActivityChange();
    }

    /** What the old profile owes is sent, or stays queued under its own scope, before the scope moves. */
    private async drain(
        activity: ActivitySyncRuntime,
        favorites: FavoritesSyncRuntime,
        history: HistorySyncRuntime
    ): Promise<void> {
        // Wait out a refresh already running on the old scope.
        await Promise.all([
            activity.refresh().catch(noop),
            favorites.refresh().catch(noop),
            history.refresh().catch(noop),
        ]);
        await activity.client?.flush().catch(noop);
        await activity.client?.stopDelivery().catch(noop);
        await favorites.client?.flush().catch(noop);
        for (const sourceId of history.client?.contexts.keys() ?? [])
            await history.client?.flush(sourceId).catch(noop);
    }
}
