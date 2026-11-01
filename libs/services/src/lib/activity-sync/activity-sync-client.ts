import { ActivityDeliveryCoordinator } from './activity-delivery-coordinator';
import { createRandomId } from '@iptvnator/shared/interfaces';
import { beginActivity } from './activity-sync-sessions';
import { saveActivity } from './activity-sync-sessions';
import { resetActivity } from './activity-sync-sessions';
import { resolveActivity } from './activity-sync-resolution';
import { sendPendingActivity } from './activity-sync-delivery';
import type {
    PlaybackPositionData,
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    activityAddressKey,
    applyActivityOperation,
    emptyActivityState,
    type ActivityState,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityContentIdentity,
    type ActivityLocalStore,
    type ActivityOperation,
    type ActivitySourceContext,
    type ActivityListResponse,
} from '@iptvnator/shared/interfaces/activity-sync';
import {
    activityIdentityKey,
    projectActivity,
    activityPositionMetadata as metadata,
    activityResume,
} from './activity-projection';

export interface ActivityClientOptions {
    instanceId: string;
    deviceId: string;
    consent(): string | null;
    request(value: SourceServerRequest): Promise<SourceServerResponse>;
    changed(): void;
    status(
        value: 'ready' | 'offline' | 'conflict' | 'pending' | 'incompatible'
    ): void;
    contexts?: ActivitySourceContext[];
    remember?(contexts: ActivitySourceContext[]): void;
}

/** All network work is secondary to the durable local mutation. */
export class ActivitySyncClient {
    readonly contexts = new Map<string, ActivitySourceContext>();
    readonly aliases = new Map<string, PlaybackPositionData>();
    readonly sessions = new Map<
        string,
        Promise<{ address: ActivityAddress; generation: number }>
    >();
    readonly delivery = new ActivityDeliveryCoordinator(this);
    readonly retiredSessions = new Set<string>();
    private flushing?: Promise<void>;
    constructor(
        readonly store: ActivityLocalStore,
        readonly options: ActivityClientOptions
    ) {
        for (const context of options.contexts ?? [])
            this.contexts.set(context.sourceId, context);
    }

    register(sourceId: string, positions: PlaybackPositionData[]): void {
        for (const position of positions)
            if (position.activityIdentity) {
                this.aliases.set(
                    JSON.stringify([
                        sourceId,
                        activityIdentityKey(position.activityIdentity),
                    ]),
                    { ...position, playlistId: sourceId }
                );
            }
    }

    async address(
        sourceId: string,
        position: Partial<PlaybackPositionData>
    ): Promise<ActivityAddress> {
        let context = this.contexts.get(sourceId);
        if (!context) {
            context = (await this.request({
                operation: 'activity-context',
                id: sourceId,
            })) as ActivitySourceContext;
            this.contexts.set(sourceId, context);
            this.options.remember?.([...this.contexts.values()]);
        }
        const id = String(position.contentXtreamId);
        let content: ActivityContentIdentity | undefined =
            position.activityIdentity;
        if (!content && position.contentType === 'vod')
            content = { provider: context.provider, kind: 'vod', id };
        if (
            !content &&
            context.provider === 'xtream' &&
            position.seriesXtreamId
        ) {
            content = {
                provider: 'xtream',
                kind: 'episode',
                id,
                seriesId: String(position.seriesXtreamId),
            };
        }
        if (!content) {
            const aliases = [...this.aliases.values()].filter(
                (candidate) =>
                    candidate.playlistId === sourceId &&
                    candidate.contentXtreamId === position.contentXtreamId &&
                    candidate.contentType === position.contentType
            );
            if (aliases.length === 1) content = aliases[0].activityIdentity;
        }
        if (!content || content.provider !== context.provider)
            throw new Error('Activity identity unavailable');
        return {
            instanceId: this.options.instanceId,
            scope: 'shared',
            sourceId,
            sourceIncarnation: context.sourceIncarnation,
            content,
        };
    }

    begin(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<{ address: ActivityAddress; generation: number }> {
        return beginActivity.call(this, sourceId, position);
    }

    async save(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        return saveActivity.call(this, sourceId, position);
    }

    async reset(
        sourceId: string,
        position: Partial<PlaybackPositionData>
    ): Promise<void> {
        return resetActivity.call(this, sourceId, position);
    }

    async refresh(sourceId: string): Promise<void> {
        if (!this.options.consent()) return;
        try {
            const context = (await this.request({
                operation: 'activity-context',
                id: sourceId,
            })) as ActivitySourceContext;
            this.contexts.set(sourceId, context);
            this.options.remember?.([...this.contexts.values()]);
            let cursor: string | undefined;
            const seen = new Set<string>();
            do {
                const page = (await this.request({
                    operation: 'activity-list',
                    id: sourceId,
                    cursor,
                })) as ActivityListResponse;
                for (const entry of page.entries) {
                    if (
                        entry.address.instanceId !== this.options.instanceId ||
                        entry.address.sourceId !== sourceId ||
                        entry.address.sourceIncarnation !==
                            context.sourceIncarnation
                    )
                        throw new Error('Activity scope mismatch');
                    await this.store.mutate(entry.address, (current) => {
                        if (
                            current?.pending.length ||
                            (current &&
                                current.state.revision > entry.state.revision)
                        )
                            return current;
                        return {
                            state: entry.state,
                            position: projectActivity(
                                entry.address,
                                entry.state,
                                this.alias(entry.address)
                            ),
                            pending: [],
                        };
                    });
                }
                cursor = page.cursor;
                if (cursor && seen.has(cursor))
                    throw new Error('Activity cursor repeated');
                if (cursor) seen.add(cursor);
            } while (cursor);
            this.options.changed();
            await this.flush();
        } catch {
            this.options.status('offline');
        }
    }

    async resolve(address: ActivityAddress, useLocal: boolean): Promise<void> {
        return resolveActivity.call(this, address, useLocal);
    }

    async importPosition(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        const address = await this.address(sourceId, position);
        const watched =
            position.watched === true ||
            (!!position.durationSeconds &&
                Math.round(
                    (position.positionSeconds / position.durationSeconds) * 100
                ) >= 90);
        const operation: ActivityOperation = {
            kind: 'import',
            operationId: createRandomId(),
            deviceId: this.options.deviceId,
            expectedRevision: 0,
            watched,
            positionMetadata: metadata(position),
            resume: watched ? null : activityResume(position),
        };
        await this.store.mutate(address, (current) => {
            const state = current?.state ?? emptyActivityState();
            const result = applyActivityOperation(state, operation);
            return {
                state: result.state,
                position,
                pending: [
                    ...(current?.pending ?? []),
                    { address, operation, consentGeneration: this.consent() },
                ],
                ...(result.status === 'conflict' ? { conflict: state } : {}),
            };
        });
        this.options.changed();
        await this.flush();
    }

    async positions(
        sourceId: string
    ): Promise<
        { position: PlaybackPositionData; reset: boolean; conflict: boolean }[]
    > {
        const incarnation = this.contexts.get(sourceId)?.sourceIncarnation;
        return (await this.store.entries(sourceId))
            .filter(
                (entry) =>
                    !incarnation ||
                    entry.address.sourceIncarnation === incarnation
            )
            .map(({ address, record }) => ({
                position: {
                    ...(record.position ??
                        projectActivity(address, record.state)),
                    ...metadata(
                        this.alias(address) ??
                            record.position ??
                            projectActivity(address, record.state)
                    ),
                    watched: record.position?.watched ?? record.state.watched,
                },
                reset:
                    !record.state.resume &&
                    !record.state.watched &&
                    !record.state.owner,
                conflict: !!record.conflict,
            }));
    }

    stopDelivery(): Promise<void> {
        return this.delivery.release();
    }

    flush(): Promise<void> {
        if (!this.options.consent()) return Promise.resolve();
        return (this.flushing ??= this.sendPending().finally(() => {
            this.flushing = undefined;
        }));
    }

    async sendPending(): Promise<void> {
        return sendPendingActivity.call(this);
    }

    alias(address: ActivityAddress): PlaybackPositionData | undefined {
        return this.aliases.get(
            JSON.stringify([
                address.sourceId,
                activityIdentityKey(address.content),
            ])
        );
    }
    consent(): string {
        const consent = this.options.consent();
        if (!consent) throw new Error('Activity consent disabled');
        return consent;
    }
    async request(request: SourceServerRequest): Promise<unknown> {
        if (!this.options.consent())
            throw new Error('Activity consent disabled');
        const generation = this.consent();
        const response = await this.options.request(request);
        if (generation !== this.options.consent())
            throw new Error('Activity consent changed');
        if (response.status !== 200) throw new Error('Activity request failed');
        return response.body;
    }
}
