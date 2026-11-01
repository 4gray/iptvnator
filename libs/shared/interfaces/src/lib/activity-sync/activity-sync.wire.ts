import type {
    ActivityAddress,
    ActivityApplyResult,
    ActivityOperation,
    ActivityState,
} from './activity-sync.contract';
import { activityAddressKey } from './activity-sync.identity';
import {
    applyActivityOperation,
    emptyActivityState,
} from './activity-sync.reducer';

export const ACTIVITY_SYNC_CAPABILITY = 'activity-v1';
export interface ActivitySourceContext {
    sourceId: string;
    sourceIncarnation: string;
    provider: 'xtream' | 'stalker';
}
export interface ActivityServerEntry {
    address: ActivityAddress;
    state: ActivityState;
}
export type ActivityServerRequest =
    | { operation: 'activity-context'; id: string }
    | { operation: 'activity-list'; id: string; cursor?: string }
    | { operation: 'activity-read'; activity: { address: ActivityAddress } }
    | {
          operation: 'activity-apply';
          activity: { address: ActivityAddress; operation: ActivityOperation };
      };
export interface ActivityListResponse {
    entries: ActivityServerEntry[];
    cursor?: string;
}
export type ActivityServerResult =
    | ActivityApplyResult
    | ActivityListResponse
    | ActivitySourceContext
    | ActivityState;

/** Select fields before persistence: unknown snapshot/credential properties never cross the boundary. */
export function parseActivityAddress(value: unknown): ActivityAddress {
    const input = value as ActivityAddress;
    activityAddressKey(input);
    const c = input.content;
    const content =
        c.kind === 'vod'
            ? { provider: c.provider, kind: c.kind, id: c.id }
            : c.provider === 'xtream'
              ? {
                    provider: c.provider,
                    kind: c.kind,
                    id: c.id,
                    seriesId: c.seriesId,
                }
              : {
                    provider: c.provider,
                    kind: c.kind,
                    id: c.id,
                    seriesId: c.seriesId,
                    mode: c.mode,
                    seasonKey: c.seasonKey,
                    episodeNumber: c.episodeNumber,
                };
    return {
        instanceId: input.instanceId,
        scope: 'shared',
        sourceId: input.sourceId,
        sourceIncarnation: input.sourceIncarnation,
        content,
    } as ActivityAddress;
}

export function parseActivityOperation(value: unknown): ActivityOperation {
    const input = value as ActivityOperation;
    let operation: ActivityOperation;
    const base = {
        operationId: input.operationId,
        deviceId: input.deviceId,
        ...(input.positionMetadata
            ? {
                  positionMetadata: parsePositionMetadata(
                      input.positionMetadata
                  ),
              }
            : {}),
    };
    if (input.kind === 'checkpoint') {
        operation = {
            ...base,
            kind: input.kind,
            generation: input.generation,
            sessionId: input.sessionId,
            sequence: input.sequence,
            resume: {
                positionSeconds: input.resume.positionSeconds,
                ...(input.resume.durationSeconds === undefined
                    ? {}
                    : { durationSeconds: input.resume.durationSeconds }),
            },
        };
    } else if (input.kind === 'import') {
        operation = {
            ...base,
            kind: input.kind,
            expectedRevision: input.expectedRevision,
            watched: input.watched,
            resume:
                input.resume === null
                    ? null
                    : {
                          positionSeconds: input.resume.positionSeconds,
                          ...(input.resume.durationSeconds === undefined
                              ? {}
                              : {
                                    durationSeconds:
                                        input.resume.durationSeconds,
                                }),
                      },
        };
    } else if (input.kind === 'begin') {
        operation = {
            ...base,
            kind: input.kind,
            expectedRevision: input.expectedRevision,
            sessionId: input.sessionId,
        };
    } else if (input.kind === 'reset' || input.kind === 'mark-watched') {
        operation = {
            ...base,
            kind: input.kind,
            expectedRevision: input.expectedRevision,
        };
    } else throw new Error('Invalid activity operation');
    const state = emptyActivityState();
    if (operation.kind !== 'checkpoint')
        state.revision = operation.expectedRevision;
    applyActivityOperation(state, operation);
    return operation;
}

/** Narrow runtime bridge for local transactions; arbitrary SQL and callbacks never cross IPC. */
export type ActivityLocalRequest =
    | { operation: 'read'; instanceId: string; address: ActivityAddress }
    | { operation: 'list'; instanceId: string; sourceId: string }
    | { operation: 'pending'; instanceId: string }
    | {
          operation: 'commit';
          instanceId: string;
          address: ActivityAddress;
          expected: string | null;
          value: import('./activity-sync.contract').ActivityLocalRecord;
      };

function parsePositionMetadata(
    value: import('./activity-sync.contract').ActivityPositionMetadata
) {
    if (
        value.title !== undefined &&
        (typeof value.title !== 'string' || value.title.length > 512)
    )
        throw new Error('Invalid activity title');
    const result = {
        contentXtreamId: value.contentXtreamId,
        ...(value.seriesXtreamId === undefined
            ? {}
            : { seriesXtreamId: value.seriesXtreamId }),
        ...(value.seasonNumber === undefined
            ? {}
            : { seasonNumber: value.seasonNumber }),
        ...(value.episodeNumber === undefined
            ? {}
            : { episodeNumber: value.episodeNumber }),
    };
    if (
        Object.values(result).some(
            (number) => !Number.isSafeInteger(number) || number < 0
        )
    )
        throw new Error('Invalid position metadata');
    return {
        ...result,
        ...(value.title === undefined ? {} : { title: value.title }),
    };
}
