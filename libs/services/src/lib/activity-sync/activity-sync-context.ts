import type { ActivitySourceContext } from '@iptvnator/shared/interfaces/activity-sync';
import { ActivitySupersededError } from './activity-action-fence';
import type { ActivitySyncClient } from './activity-sync-client';

export interface ActivityContextVersion {
    next: number;
    accepted: number;
}

export function activityContextVersion(
    client: ActivitySyncClient,
    sourceId: string
): ActivityContextVersion {
    let version = client.contextVersions.get(sourceId);
    if (!version) {
        version = { next: 0, accepted: 0 };
        client.contextVersions.set(sourceId, version);
    }
    return version;
}

/** Preserve newer accepted scopes while allowing concurrent reads of the same incarnation. */
export async function readActivityContext(
    this: ActivitySyncClient,
    sourceId: string,
    currentAction?: () => boolean
): Promise<ActivitySourceContext> {
    const version = activityContextVersion(this, sourceId);
    const sequence = ++version.next;
    const context = (await this.request({
        operation: 'activity-context',
        id: sourceId,
    })) as ActivitySourceContext;
    if (currentAction && !currentAction())
        throw new ActivitySupersededError('Activity launch superseded');
    if (sequence < version.accepted) {
        const current = this.contexts.get(sourceId);
        if (
            current?.sourceIncarnation === context.sourceIncarnation &&
            current.provider === context.provider
        )
            return current;
        throw new ActivitySupersededError('Activity source context superseded');
    }
    this.acceptContext(context, sequence);
    this.options.remember?.([...this.contexts.values()]);
    return context;
}

export function activityConsentMatches(
    this: ActivitySyncClient,
    generation?: string
): boolean {
    try {
        return (
            generation !== undefined && this.options.consent() === generation
        );
    } catch {
        return false;
    }
}
