import type Database from 'better-sqlite3';
import { SqliteActivityLocalStore } from '@iptvnator/shared/database/activity-sync';
import {
    assertActivityToken,
    parseActivityAddress,
    type ActivityLocalRequest,
} from '@iptvnator/shared/interfaces/activity-sync';

export async function activityLocalOperation(
    database: Database.Database,
    request: ActivityLocalRequest
): Promise<unknown> {
    assertActivityToken(request.instanceId);
    const store = new SqliteActivityLocalStore(database, request.instanceId);
    if (request.operation === 'pending') return store.pending();
    if (request.operation === 'list') return store.entries(request.sourceId);
    const address = parseActivityAddress(request.address);
    if (request.operation === 'read') return store.read(address);
    if (request.operation !== 'commit')
        throw new Error('Invalid activity storage operation');
    try {
        const value = await store.mutate(address, (current) => {
            if (
                (current === null ? null : JSON.stringify(current)) !==
                request.expected
            ) {
                throw new Error('activity_local_conflict');
            }
            return request.value;
        });
        return { value };
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'activity_local_conflict'
        )
            return { conflict: true };
        throw new Error('Activity storage failed');
    }
}
