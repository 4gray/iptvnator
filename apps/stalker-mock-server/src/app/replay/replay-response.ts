import { ReplaySymbolTable } from './replay-symbols.js';
import {
    ReplayOriginUrlNode,
    ReplayRenderedResponse,
    ReplayResponseDefinition,
    ReplayResponseHeaderValue,
} from './replay.types.js';

export type ReplayOriginUrlMap = Readonly<Record<string, string>>;

export class ReplayResponseError extends Error {
    constructor(readonly code: 'unknown-origin-url') {
        super(`Replay response rejected: ${code}.`);
        this.name = 'ReplayResponseError';
    }
}

function isOriginUrlNode(
    value: ReplayResponseHeaderValue
): value is ReplayOriginUrlNode {
    return typeof value !== 'string' && value.kind === 'origin-url';
}

function renderHeaderValue(
    value: ReplayResponseHeaderValue,
    symbols: ReplaySymbolTable,
    originUrls: ReplayOriginUrlMap
): string {
    if (!isOriginUrlNode(value)) {
        return symbols.resolveString(value);
    }
    const originUrl = originUrls[value.origin];
    if (originUrl === undefined) {
        throw new ReplayResponseError('unknown-origin-url');
    }
    return `${originUrl}${value.path}`;
}

export function renderReplayResponse(
    response: ReplayResponseDefinition,
    symbols: ReplaySymbolTable,
    originUrls: ReplayOriginUrlMap = {}
): ReplayRenderedResponse {
    const headers = Object.fromEntries(
        Object.entries(response.headers).map(([name, values]) => [
            name,
            values.map((value) =>
                renderHeaderValue(value, symbols, originUrls)
            ),
        ])
    );

    let body: Buffer;
    switch (response.body.kind) {
        case 'empty':
            body = Buffer.alloc(0);
            break;
        case 'json':
            body = Buffer.from(
                JSON.stringify(symbols.resolveValue(response.body.value))
            );
            break;
        case 'jsonp':
            body = Buffer.from(
                `${response.body.callback}(${JSON.stringify(
                    symbols.resolveValue(response.body.value)
                )});`
            );
            break;
        case 'text':
            body = Buffer.from(symbols.resolveString(response.body.value));
            break;
        case 'generated':
            body = Buffer.alloc(response.body.byteLength, response.body.byte);
            break;
    }

    return {
        status: response.status,
        headers,
        body,
    };
}
