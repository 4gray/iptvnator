import {
    latestFavoriteBase,
    localFavoriteRecord,
    keepFavoriteImport,
} from './favorites-client-state';
import { createRandomId } from '@iptvnator/shared/interfaces';
import { deliverFavorites } from './favorites-sync-delivery';
import {
    FavoriteSupersededError,
    FavoriteRequestError,
} from './favorites-sync-errors';
export { FavoriteSupersededError } from './favorites-sync-errors';
import {
    emptyFavoriteState,
    favoriteReferenceKey,
    parseFavoriteAddress,
    assertFavoriteState,
    parseFavoriteOperation,
    type FavoriteAddress,
    type FavoriteReference,
    type FavoriteSnapshot,
    type FavoriteSourceContext,
    type FavoriteLocalStore,
    type FavoriteList,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';

export interface FavoriteClientOptions {
    instanceId: string;
    deviceId: string;
    consent(): string | null;
    request(request: SourceServerRequest): Promise<SourceServerResponse>;
    remember(contexts: FavoriteSourceContext[]): void;
    changed(): void;
    contexts?: FavoriteSourceContext[];
    profileActive?(): boolean;
}
/** Membership only: no playback sessions or resume ownership. */
export class FavoritesSyncClient {
    readonly contexts = new Map<string, FavoriteSourceContext>();
    private readonly actions = new Map<string, symbol>();
    private readonly contextRequests = new Map<string, number>();
    private readonly acceptedContexts = new Map<string, number>();
    private flushing?: Promise<void>;
    constructor(
        readonly store: FavoriteLocalStore,
        readonly options: FavoriteClientOptions
    ) {
        for (const context of options.contexts ?? [])
            this.contexts.set(context.sourceId, context);
    }
    generation(): string {
        const generation = this.options.consent();
        if (this.options.profileActive?.() === false || !generation)
            throw new FavoriteSupersededError();
        return generation;
    }
    current(generation: string): void {
        if (
            this.options.profileActive?.() === false ||
            generation !== this.options.consent()
        )
            throw new FavoriteSupersededError();
    }
    async request(
        request: SourceServerRequest,
        generation: string
    ): Promise<unknown> {
        this.current(generation);
        const response = await this.options.request(request);
        this.current(generation);
        if (response.status !== 200)
            throw new FavoriteRequestError(response.status);
        return response.body;
    }
    async context(
        sourceId: string,
        generation = this.generation()
    ): Promise<FavoriteSourceContext> {
        const owner = (this.contextRequests.get(sourceId) ?? 0) + 1;
        this.contextRequests.set(sourceId, owner);
        try {
            const context = (await this.request(
                { operation: 'favorites-context', id: sourceId },
                generation
            )) as FavoriteSourceContext;
            if (owner < (this.acceptedContexts.get(sourceId) ?? 0)) {
                const current = this.contexts.get(sourceId);
                if (
                    current?.sourceIncarnation === context.sourceIncarnation &&
                    current.provider === context.provider
                )
                    return current;
                throw new FavoriteSupersededError();
            }
            if (
                context.sourceId !== sourceId ||
                !context.sourceIncarnation ||
                !['m3u', 'xtream', 'stalker'].includes(context.provider)
            )
                throw new Error('Invalid favorite source');
            const next = new Map(this.contexts).set(sourceId, context);
            this.options.remember([...next.values()]);
            this.contexts.set(sourceId, context);
            this.acceptedContexts.set(sourceId, owner);
            return context;
        } catch (error) {
            this.current(generation);
            if (
                error instanceof FavoriteSupersededError ||
                (error instanceof FavoriteRequestError && !error.transient)
            )
                throw error;
            // Offline writes can use a previously verified incarnation, never a guessed one.
            const cached = this.contexts.get(sourceId);
            if (cached && owner >= (this.acceptedContexts.get(sourceId) ?? 0))
                return cached;
            throw error;
        }
    }
    forget(sourceId: string, persist = true): void {
        const next = (this.contextRequests.get(sourceId) ?? 0) + 1;
        this.contextRequests.set(sourceId, next);
        this.acceptedContexts.set(sourceId, next);
        this.contexts.delete(sourceId);
        if (persist) this.options.remember([...this.contexts.values()]);
    }
    address(
        source: FavoriteSourceContext,
        content: FavoriteReference
    ): FavoriteAddress {
        if (source.provider !== content.provider)
            throw new Error('Favorite provider mismatch');
        return parseFavoriteAddress({
            instanceId: this.options.instanceId,
            scope: 'shared',
            sourceId: source.sourceId,
            sourceIncarnation: source.sourceIncarnation,
            content,
        });
    }
    private action(sourceId: string, content: FavoriteReference): () => void {
        const key = JSON.stringify([sourceId, favoriteReferenceKey(content)]);
        const owner = Symbol();
        this.actions.set(key, owner);
        return () => {
            if (this.actions.get(key) !== owner)
                throw new FavoriteSupersededError();
        };
    }
    async setLocal(
        sourceId: string,
        content: FavoriteReference,
        member: boolean,
        snapshot?: FavoriteSnapshot,
        preserveSharedState = false
    ): Promise<void> {
        const currentAction = this.action(sourceId, content);
        const source = this.contexts.get(sourceId);
        if (!source) throw new Error('Favorite source unavailable');
        const address = this.address(source, content);
        const consent = this.options.consent();
        await this.store.mutate(address, (current) => {
            currentAction();
            if (
                this.options.profileActive?.() === false ||
                this.options.consent() !== consent ||
                this.contexts.get(sourceId)?.sourceIncarnation !==
                    source.sourceIncarnation
            )
                throw new FavoriteSupersededError();
            return localFavoriteRecord(
                current,
                member,
                snapshot,
                preserveSharedState
            );
        });
        this.options.changed();
    }
    async set(
        sourceId: string,
        content: FavoriteReference,
        member: boolean,
        snapshot?: FavoriteSnapshot,
        importing = false
    ): Promise<void> {
        const generation = this.generation();
        const currentAction = this.action(sourceId, content);
        const knownIncarnation = this.contexts.get(sourceId)?.sourceIncarnation;
        const context = await this.context(sourceId, generation);
        if (knownIncarnation && knownIncarnation !== context.sourceIncarnation)
            throw new FavoriteSupersededError();
        const address = this.address(context, content);
        const operationId = createRandomId();
        await this.store.mutate(address, (current) => {
            this.current(generation);
            currentAction();
            if (
                this.contexts.get(sourceId)?.sourceIncarnation !==
                context.sourceIncarnation
            )
                throw new FavoriteSupersededError();
            const base = current?.base ?? emptyFavoriteState();
            const pending = current?.pending ?? [];
            // A parked queue is never silently authorized by a newer explicit action.
            if (
                pending.some(
                    (intent) => intent.consentGeneration !== generation
                )
            )
                throw new Error('Favorite queue requires choice');
            if (importing && keepFavoriteImport(current, member, snapshot))
                return current;
            const expectedRevision = importing
                ? 0
                : (current?.state.revision ?? base.revision);
            const operation = parseFavoriteOperation({
                operationId,
                deviceId: this.options.deviceId,
                expectedRevision,
                member,
                ...(snapshot ? { snapshot } : {}),
            });
            return {
                ...current,
                base,
                conflict: undefined,
                local: undefined,
                localOnly: false,
                state: {
                    revision: expectedRevision + 1,
                    member,
                    ...(snapshot ? { snapshot } : {}),
                },
                pending: [
                    ...pending,
                    { address, consentGeneration: generation, operation },
                ],
            };
        });
        this.options.changed();
        try {
            await this.flush();
        } catch {
            this.options.changed();
        }
    }
    async refresh(sourceId: string, deliver = true): Promise<void> {
        const generation = this.generation();
        const source = await this.context(sourceId, generation);
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
            const page = (await this.request(
                { operation: 'favorites-list', id: sourceId, cursor },
                generation
            )) as FavoriteList;
            if (!Array.isArray(page.entries))
                throw new Error('Invalid favorite list');
            for (const entry of page.entries) {
                const address = parseFavoriteAddress(entry.address);
                assertFavoriteState(entry.state);
                if (
                    address.instanceId !== this.options.instanceId ||
                    address.sourceId !== sourceId ||
                    address.sourceIncarnation !== source.sourceIncarnation ||
                    address.content.provider !== source.provider
                )
                    throw new Error('Favorite scope mismatch');
                await this.store.mutate(address, (current) => {
                    this.current(generation);
                    if (
                        this.contexts.get(sourceId)?.sourceIncarnation !==
                        source.sourceIncarnation
                    )
                        throw new FavoriteSupersededError();
                    if (current && current.base.revision > entry.state.revision)
                        return current;
                    if (current?.pending.length)
                        return {
                            ...current,
                            base: entry.state,
                            ...(current.conflict
                                ? { conflict: entry.state }
                                : {}),
                        };
                    return {
                        ...current,
                        state: entry.state,
                        base: entry.state,
                        pending: [],
                    };
                });
            }
            cursor = page.cursor;
            if (cursor && (typeof cursor !== 'string' || seen.has(cursor)))
                throw new Error('Invalid favorite cursor');
            if (cursor) seen.add(cursor);
        } while (cursor);
        if (deliver) await this.flush();
        this.options.changed();
    }
    async entries(sourceId: string) {
        if (this.options.profileActive?.() === false)
            throw new FavoriteSupersededError();
        const incarnation = this.contexts.get(sourceId)?.sourceIncarnation;
        const rows = await this.store.entries(sourceId);
        if (
            this.options.profileActive?.() === false ||
            this.contexts.get(sourceId)?.sourceIncarnation !== incarnation
        )
            throw new FavoriteSupersededError();
        return rows.filter(
            (entry) => entry.address.sourceIncarnation === incarnation
        );
    }
    flush(): Promise<void> {
        if (!this.options.consent()) return Promise.resolve();
        return (this.flushing ??= deliverFavorites
            .call(this)
            .finally(() => (this.flushing = undefined)));
    }
    async resolve(address: FavoriteAddress, useLocal: boolean): Promise<void> {
        const currentAction = this.action(address.sourceId, address.content);
        const generation = this.generation();
        const operationId = createRandomId();
        await this.store.mutate(address, (current) => {
            this.current(generation);
            currentAction();
            if (
                !current ||
                address.sourceIncarnation !==
                    this.contexts.get(address.sourceId)?.sourceIncarnation
            )
                throw new FavoriteSupersededError();
            const base = latestFavoriteBase(current);
            return {
                ...current,
                base,
                conflict: undefined,
                local: undefined,
                localOnly: false,
                state: useLocal
                    ? { ...current.state, revision: base.revision + 1 }
                    : base,
                pending: useLocal
                    ? [
                          {
                              address,
                              consentGeneration: generation,
                              operation: {
                                  deviceId: this.options.deviceId,
                                  operationId,
                                  expectedRevision: base.revision,
                                  member: current.state.member,
                                  ...(current.state.snapshot
                                      ? { snapshot: current.state.snapshot }
                                      : {}),
                              },
                          },
                      ]
                    : [],
            };
        });
        await this.flush();
    }
    async parked(sourceId: string, send: boolean): Promise<void> {
        const generation = this.generation();
        for (const { address } of await this.entries(sourceId))
            await this.store.mutate(address, (current) => {
                this.current(generation);
                if (!current) throw new FavoriteSupersededError();
                if (
                    !current.pending.some(
                        (intent) => intent.consentGeneration !== generation
                    )
                )
                    return current;
                return send
                    ? {
                          ...current,
                          pending: current.pending.map((intent) => ({
                              ...intent,
                              consentGeneration: generation,
                          })),
                      }
                    : {
                          ...current,
                          local: current.state,
                          localOnly: true,
                          state: current.base,
                          pending: [],
                          conflict: undefined,
                      };
            });
        await this.flush();
        this.options.changed();
    }
}
