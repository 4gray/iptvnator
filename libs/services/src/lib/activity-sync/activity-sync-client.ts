import {
    commitActivity,
    type FailedActivitySession,
} from './activity-sync-committed';
import {
    readActivityContext,
    activityContextVersion,
    activityConsentMatches,
    type ActivityContextVersion,
} from './activity-sync-context';
import {
    ActivityActionFence,
    ActivitySupersededError,
} from './activity-action-fence';
import { ActivityMutationBarrier } from './activity-mutation-barrier';
import { ActivityDeliveryCoordinator } from './activity-delivery-coordinator';
import { createRandomId } from '@iptvnator/shared/interfaces';
import { beginActivity } from './activity-sync-sessions';
import { saveActivity } from './activity-sync-sessions';
import { resetActivity } from './activity-sync-sessions';
import { ActivityRequestError } from './activity-scope-refusal';
import { scopeRefusalOf } from '../profiles/scope-refusal';
import { readActivityPositions } from './activity-sync-positions';
import { resolveActivity } from './activity-sync-resolution';
import { sendPendingActivity } from './activity-sync-delivery';
import type {
    PlaybackPositionData,
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
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
    activityImportResume,
} from './activity-projection';
import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';

export interface ActivityClientOptions {
    instanceId: string;
    deviceId: string;
    consent(): string | null;
    profileActive?(): boolean;
    request(value: SourceServerRequest): Promise<SourceServerResponse>;
    changed(): void;
    committed?(
        sourceId: string,
        position: Partial<PlaybackPositionData>,
        kind: 'begin' | 'checkpoint' | 'command'
    ): void;
    status(
        value: 'ready' | 'offline' | 'conflict' | 'pending' | 'incompatible'
    ): void;
    /** An obsolete failure preserves a newer local record instead of replacing its ownership. */
    failedLaunch?(
        sourceId: string,
        position: PlaybackPositionData,
        incarnation?: string,
        preserveLocal?: boolean
    ): void;
    contexts?: ActivitySourceContext[];
    remember?(contexts: ActivitySourceContext[]): void;
    /** Whose activity this client reads and writes; fixed for the client's life. */
    scope?: PersonalScope;
}

/** All network work is secondary to the durable local mutation. */
export class ActivitySyncClient {
    readonly consentMatches = activityConsentMatches.bind(this);
    readonly committed = commitActivity.bind(this);
    readonly readContext = readActivityContext.bind(this);
    readonly contextVersions = new Map<string, ActivityContextVersion>();
    readonly actions = new ActivityActionFence();
    readonly contexts = new Map<string, ActivitySourceContext>();
    readonly aliases = new Map<string, PlaybackPositionData>();
    readonly sessions = new Map<
        string,
        Promise<{ address: ActivityAddress; generation: number }>
    >();
    readonly delivery = new ActivityDeliveryCoordinator(this);
    readonly retiredSessions = new Set<string>();
    readonly localSessions = new Map<string, FailedActivitySession>();
    private flushing?: Promise<void>;
    private readonly mutations = new ActivityMutationBarrier();
    readonly store: ActivityLocalStore;
    readonly scope: PersonalScope;
    constructor(
        store: ActivityLocalStore,
        readonly options: ActivityClientOptions
    ) {
        this.store = {
            read: (address) => store.read(address),
            entries: (sourceId) => store.entries(sourceId),
            pending: () => store.pending(),
            mutate: (address, update) =>
                this.mutations.track(store.mutate(address, update)),
        };
        this.scope = options.scope ?? DEFAULT_PERSONAL_SCOPE;
        for (const context of options.contexts ?? [])
            this.contexts.set(context.sourceId, context);
    }

    forgetContext(sourceId: string): void {
        const version = activityContextVersion(this, sourceId);
        version.accepted = ++version.next;
        this.contexts.delete(sourceId);
    }

    acceptContext(context: ActivitySourceContext, sequence?: number): void {
        const version = activityContextVersion(this, context.sourceId);
        version.accepted = sequence ?? ++version.next;
        const previous = this.contexts.get(context.sourceId);
        for (const [id, session] of this.localSessions) {
            if (session.sourceId !== context.sourceId) continue;
            if (
                session.incarnation &&
                session.incarnation !== context.sourceIncarnation
            ) {
                this.localSessions.delete(id);
                this.retiredSessions.add(id);
            } else session.incarnation = context.sourceIncarnation;
        }
        if (
            previous &&
            previous.sourceIncarnation !== context.sourceIncarnation
        )
            for (const [key, alias] of this.aliases)
                if (alias.playlistId === context.sourceId)
                    this.aliases.delete(key);
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
        position: Partial<PlaybackPositionData>,
        currentAction?: () => boolean
    ): Promise<ActivityAddress> {
        let context = this.contexts.get(sourceId);
        if (!context) context = await this.readContext(sourceId, currentAction);
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
            scope: this.scope,
            sourceId,
            sourceIncarnation: context.sourceIncarnation,
            content,
        };
    }

    begin(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<{ address: ActivityAddress; generation: number }> {
        return this.mutations.track(
            beginActivity.call(this, sourceId, position)
        );
    }

    async save(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<'local-only' | void> {
        const write = this.actions.savePosition(
            sourceId,
            position,
            (playedAt, current) =>
                saveActivity.call(this, sourceId, position, playedAt, current)
        );
        return this.mutations.track(write);
    }

    async reset(
        sourceId: string,
        position: Partial<PlaybackPositionData>,
        currentAction?: () => boolean
    ): Promise<'local-only' | void> {
        return this.mutations.track(
            resetActivity.call(this, sourceId, position, currentAction)
        );
    }

    async refresh(sourceId: string): Promise<void> {
        if (!this.options.consent()) return;
        try {
            const context = await this.readContext(sourceId);
            let cursor: string | undefined;
            const seen = new Set<string>();
            do {
                const page = (await this.request({
                    operation: 'activity-list',
                    id: sourceId,
                    cursor,
                    ...(this.scope === DEFAULT_PERSONAL_SCOPE
                        ? {}
                        : { scope: this.scope }),
                })) as ActivityListResponse;
                for (const entry of page.entries) {
                    if (
                        entry.address.instanceId !== this.options.instanceId ||
                        entry.address.scope !== this.scope ||
                        entry.address.sourceId !== sourceId ||
                        entry.address.sourceIncarnation !==
                            context.sourceIncarnation
                    )
                        throw new Error('Activity scope mismatch');
                    await this.store.mutate(entry.address, (current) => {
                        // An equal revision may omit a locally acknowledged capture time.
                        if (
                            current?.pending.length ||
                            (current &&
                                current.state.revision >= entry.state.revision)
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
        } catch (error) {
            if (error instanceof ActivitySupersededError) return;
            this.options.status('offline');
        }
    }

    async resolve(
        address: ActivityAddress,
        useLocal: boolean,
        preserveLocal = false
    ): Promise<void> {
        return resolveActivity.call(this, address, useLocal, preserveLocal);
    }

    async importPosition(
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        const currentAction = this.actions.position(sourceId, position);
        const consentGeneration = this.consent();
        const address = await this.address(
            sourceId,
            position,
            currentAction
        ).catch((error) => {
            if (currentAction() && !(error instanceof ActivitySupersededError))
                throw error;
        });
        if (!address) return;
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
            resume: watched ? null : activityImportResume(address, position),
        };
        await this.store
            .mutate(address, (current) => {
                if (!currentAction())
                    throw new Error('Activity action superseded');
                const state = current?.state ?? emptyActivityState();
                const result = applyActivityOperation(state, operation);
                return {
                    state: result.state,
                    position: { ...position, watched },
                    pending: [
                        ...(current?.pending ?? []),
                        { address, operation, consentGeneration },
                    ],
                    ...(result.status === 'conflict'
                        ? { conflict: state }
                        : {}),
                };
            })
            .catch((error) => {
                if (
                    currentAction() &&
                    !(error instanceof ActivitySupersededError)
                )
                    throw error;
            });
        if (currentAction() && this.consentMatches(consentGeneration))
            this.committed(sourceId, position, 'command');
        this.options.changed();
        await this.flush();
    }

    positions(sourceId: string): ReturnType<typeof readActivityPositions> {
        return readActivityPositions(this, sourceId);
    }

    async stopDelivery(): Promise<void> {
        await this.mutations.drain();
        await this.delivery.release();
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
        if (response.status !== 200)
            throw new ActivityRequestError(
                scopeRefusalOf(response.status, response.body)
            );
        return response.body;
    }
}
