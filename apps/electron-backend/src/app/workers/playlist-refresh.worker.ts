import { parentPort } from 'worker_threads';
import { parse } from 'iptv-playlist-parser';
import { readFile } from 'node:fs/promises';
import {
    createPlaylistObject,
    getFilenameFromUrl,
} from '@iptvnator/shared/m3u-utils';
import { createPlaylistAgentFactory } from '../util/secure-https';
import type {
    Playlist,
    PlaylistRefreshEvent,
    PlaylistRefreshPayload,
} from '@iptvnator/shared/interfaces';
import type {
    PlaylistRefreshWorkerIncomingMessage,
    PlaylistRefreshWorkerMessage,
} from './playlist-refresh.worker.types';
import {
    createInvalidTlsCertificateError,
    getHostnameFromErrorUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { PLAYLIST_FETCH_TIMEOUT_MS } from '../events/playlist-source';
import {
    armWorkerPerformanceCapture,
    executeWithWorkerPerformanceCapture,
    stampWorkerPerformanceResponsePostedEpoch,
    startWorkerPerformanceCapture,
} from './worker-performance-capture';

type ActiveRefreshState = {
    cancelled: boolean;
    controller: AbortController;
};

const activeRefreshes = new Map<string, ActiveRefreshState>();

if (!parentPort) {
    throw new Error(
        'Playlist refresh worker must be started with a parent port'
    );
}

function postMessage(message: PlaylistRefreshWorkerMessage<Playlist>): void {
    parentPort?.postMessage(message);
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return {
        message: String(error),
    };
}

function createAbortError(operationId: string): Error {
    const error = new Error(`Playlist refresh "${operationId}" was cancelled`);
    error.name = 'AbortError';
    return error;
}

function emitEvent(
    payload: PlaylistRefreshPayload,
    partial: Omit<PlaylistRefreshEvent, 'operationId' | 'playlistId'>
): void {
    postMessage({
        type: 'event',
        event: {
            operationId: payload.operationId,
            playlistId: payload.playlistId,
            ...partial,
        },
    });
}

function checkpoint(payload: PlaylistRefreshPayload): void {
    const active = activeRefreshes.get(payload.operationId);
    if (active?.cancelled) {
        throw createAbortError(payload.operationId);
    }
}

function releaseActiveRefresh(
    operationId: string,
    activeRefresh: ActiveRefreshState
): void {
    if (activeRefreshes.get(operationId) === activeRefresh) {
        activeRefreshes.delete(operationId);
    }
}

async function fetchPlaylistFromUrl(
    payload: PlaylistRefreshPayload,
    controller: AbortController
): Promise<Playlist> {
    emitEvent(payload, { status: 'started', phase: 'fetching' });
    checkpoint(payload);

    let result;
    try {
        result = await requestWithValidatedRedirects<string>(
            payload.url!,
            {
                agentFactory: createPlaylistAgentFactory({
                    trustedInsecureTlsHosts: payload.trustedInsecureTlsHosts,
                }),
                method: 'GET',
                ...(payload.userAgent?.trim()
                    ? { headers: { 'User-Agent': payload.userAgent.trim() } }
                    : {}),
                signal: controller.signal,
                timeout: PLAYLIST_FETCH_TIMEOUT_MS,
            },
            { allowPrivateNetworks: true }
        );
    } catch (error) {
        if (isInvalidTlsCertificateError(error)) {
            throw createInvalidTlsCertificateError(
                getHostnameFromErrorUrl(error, payload.url!)
            );
        }
        throw error;
    }

    checkpoint(payload);
    emitEvent(payload, { status: 'progress', phase: 'parsing' });
    const parsedPlaylist = parse(result.data);
    checkpoint(payload);

    const extractedName =
        payload.url && payload.url.length > 1
            ? getFilenameFromUrl(payload.url)
            : '';
    const playlistName =
        !extractedName || extractedName === 'Untitled playlist'
            ? 'Imported from URL'
            : extractedName;

    return createPlaylistObject(
        payload.title || playlistName,
        parsedPlaylist,
        payload.url,
        'URL'
    );
}

async function fetchPlaylistFromFile(
    payload: PlaylistRefreshPayload
): Promise<Playlist> {
    emitEvent(payload, { status: 'started', phase: 'reading-file' });
    checkpoint(payload);
    const fileContent = await readFile(payload.filePath!, 'utf-8');
    checkpoint(payload);

    emitEvent(payload, { status: 'progress', phase: 'parsing' });
    const parsedPlaylist = parse(fileContent);
    checkpoint(payload);

    return createPlaylistObject(
        payload.title,
        parsedPlaylist,
        payload.filePath,
        'FILE'
    );
}

async function executeRefresh(
    payload: PlaylistRefreshPayload,
    activeRefresh: ActiveRefreshState
): Promise<Playlist> {
    try {
        const playlist = payload.url
            ? await fetchPlaylistFromUrl(payload, activeRefresh.controller)
            : await fetchPlaylistFromFile(payload);

        checkpoint(payload);
        return playlist;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            emitEvent(payload, {
                status: 'cancelled',
                phase: 'parsing',
            });
        } else {
            emitEvent(payload, {
                status: 'error',
                phase: payload.url ? 'fetching' : 'reading-file',
                error: error instanceof Error ? error.message : String(error),
            });
        }
        throw error;
    } finally {
        releaseActiveRefresh(payload.operationId, activeRefresh);
    }
}

parentPort.on(
    'message',
    async (message: PlaylistRefreshWorkerIncomingMessage) => {
        if (message.type === 'cancel') {
            const active = activeRefreshes.get(message.operationId);
            if (active) {
                active.cancelled = true;
                active.controller.abort();
            }
            return;
        }

        const payload = message.payload;
        const activeRefresh: ActiveRefreshState = {
            cancelled: false,
            controller: new AbortController(),
        };
        activeRefreshes.set(payload.operationId, activeRefresh);

        try {
            const performanceCapture = startWorkerPerformanceCapture();
            await armWorkerPerformanceCapture(performanceCapture);
            const execution = await executeWithWorkerPerformanceCapture(
                performanceCapture,
                () => executeRefresh(payload, activeRefresh)
            );

            if (execution.success) {
                postMessage({
                    type: 'response',
                    success: true,
                    result: execution.result,
                    performance: stampWorkerPerformanceResponsePostedEpoch(
                        performanceCapture,
                        execution.performance
                    ),
                });
            } else {
                const error = execution.error;
                postMessage({
                    type: 'response',
                    success: false,
                    error: serializeError(error),
                    performance: stampWorkerPerformanceResponsePostedEpoch(
                        performanceCapture,
                        execution.performance
                    ),
                });
            }
        } finally {
            releaseActiveRefresh(payload.operationId, activeRefresh);
        }
    }
);

postMessage({ type: 'ready' });
