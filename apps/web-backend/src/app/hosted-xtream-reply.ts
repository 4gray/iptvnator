import type { Response } from 'express';

/** A catalog is validated and buffered before it can be returned as JSON.
 * Leading JSON whitespace keeps the tunnel and Android reader active meantime.
 */
export function xtreamJsonReply(res: Response, throughTunnel: boolean) {
    if (!throughTunnel) return (body: unknown) => res.json(body);

    const heartbeat = setInterval(() => {
        if (res.destroyed || res.writableNeedDrain) return;
        if (!res.headersSent) {
            res.type('json').set({
                'Cache-Control': 'no-store, no-transform',
                'X-Content-Type-Options': 'nosniff',
            });
        }
        res.write('\n');
    }, 10_000);
    heartbeat.unref();
    res.once('close', () => clearInterval(heartbeat));

    return (body: unknown) => {
        clearInterval(heartbeat);
        if (!res.headersSent) return res.json(body);
        // Headers are already on the wire. Escape HTML delimiters without changing JSON values.
        const json = JSON.stringify(body)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');
        return res.end(json);
    };
}
