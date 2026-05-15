import type { PlaylistRefreshEvent, PlaylistRefreshPayload } from '@iptvnator/shared/interfaces';

export interface PlaylistRefreshWorkerRequestMessage {
    type: 'request';
    payload: PlaylistRefreshPayload;
}

export interface PlaylistRefreshWorkerCancelMessage {
    type: 'cancel';
    operationId: string;
}

export interface PlaylistRefreshWorkerReadyMessage {
    type: 'ready';
}

export interface PlaylistRefreshWorkerEventMessage {
    type: 'event';
    event: PlaylistRefreshEvent;
}

export interface PlaylistRefreshWorkerResponseMessage<TResult = unknown> {
    type: 'response';
    success: boolean;
    result?: TResult;
    error?: {
        name?: string;
        message: string;
        stack?: string;
    };
}

export type PlaylistRefreshWorkerIncomingMessage =
    | PlaylistRefreshWorkerRequestMessage
    | PlaylistRefreshWorkerCancelMessage;

export type PlaylistRefreshWorkerMessage<TResult = unknown> =
    | PlaylistRefreshWorkerReadyMessage
    | PlaylistRefreshWorkerEventMessage
    | PlaylistRefreshWorkerResponseMessage<TResult>;
