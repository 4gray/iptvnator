import {
    XTREAM_WORKER_REQUEST_IDENTITY_KIND,
    xtreamWorkerRequestIdentityKind,
} from './xtream-worker-request-identity';

export const XTREAM_IPC_PRODUCER_NAMESPACE = {
    LEGACY_PRELOAD: 'legacy-preload',
    XTREAM_PRELOAD: 'xtream-preload',
} as const;

export type XtreamIpcProducerNamespace =
    (typeof XTREAM_IPC_PRODUCER_NAMESPACE)[keyof typeof XTREAM_IPC_PRODUCER_NAMESPACE];

export interface XtreamIpcProducerIdentity {
    readonly ipcCallId: number;
    readonly namespace: XtreamIpcProducerNamespace;
    readonly sourceEpochMs: number;
}

const LEGACY_PRELOAD_METHODS = new Set<string>([
    'dbGetAppPlaylist',
    'dbUpsertAppPlaylist',
]);
const XTREAM_PRELOAD_METHODS = new Set<string>([
    'dbCancelOperation',
    'dbDeletePlaylist',
    'dbDeleteXtreamContent',
    'dbGetCategories',
    'dbGetContent',
    'dbGlobalSearch',
    'dbRestoreXtreamUserData',
    'dbSaveCategories',
    'dbSaveContent',
    'dbSearchContent',
    'xtreamCancelSession',
    'xtreamRequest',
]);

export function xtreamIpcProducerNamespaceForMethod(
    method: string
): XtreamIpcProducerNamespace | null {
    if (LEGACY_PRELOAD_METHODS.has(method)) {
        return XTREAM_IPC_PRODUCER_NAMESPACE.LEGACY_PRELOAD;
    }
    if (XTREAM_PRELOAD_METHODS.has(method)) {
        return XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD;
    }
    return null;
}

export function xtreamIpcProducerNamespaceForWorkerOperation(
    operation: string
): XtreamIpcProducerNamespace | null {
    const kind = xtreamWorkerRequestIdentityKind(operation);
    if (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.LEGACY_PRELOAD) {
        return XTREAM_IPC_PRODUCER_NAMESPACE.LEGACY_PRELOAD;
    }
    if (
        kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_IPC ||
        kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_OPERATION
    ) {
        return XTREAM_IPC_PRODUCER_NAMESPACE.XTREAM_PRELOAD;
    }
    return null;
}

export function xtreamIpcProducerIdentityKey(
    namespace: XtreamIpcProducerNamespace,
    ipcCallId: number
): string {
    return `${namespace}\0${ipcCallId}`;
}

export function hasDistinctMonotonicXtreamIpcProducerIdentities(
    identities: readonly XtreamIpcProducerIdentity[]
): boolean {
    const keys = identities.map(({ ipcCallId, namespace }) =>
        xtreamIpcProducerIdentityKey(namespace, ipcCallId)
    );
    if (new Set(keys).size !== keys.length) return false;
    for (const namespace of Object.values(XTREAM_IPC_PRODUCER_NAMESPACE)) {
        const ordered = identities
            .filter((identity) => identity.namespace === namespace)
            .sort((left, right) => left.ipcCallId - right.ipcCallId);
        if (
            ordered.some(
                ({ sourceEpochMs }, index) =>
                    index > 0 &&
                    sourceEpochMs < Number(ordered[index - 1]?.sourceEpochMs)
            )
        ) {
            return false;
        }
    }
    return true;
}
