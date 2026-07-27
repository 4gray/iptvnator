import { ReplaySymbolTable } from './replay-symbols.js';
import {
    ReplayRenderedResponse,
    ReplayResponseDefinition,
} from './replay.types.js';

export function renderReplayResponse(
    response: ReplayResponseDefinition,
    symbols: ReplaySymbolTable
): ReplayRenderedResponse {
    const headers = Object.fromEntries(
        Object.entries(response.headers).map(([name, values]) => [
            name,
            values.map((value) => symbols.resolveString(value)),
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
