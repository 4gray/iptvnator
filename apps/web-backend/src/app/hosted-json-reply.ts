import type { Response } from 'express';

/** Leading JSON whitespace keeps a tunnel open while a response is prepared.
 * Callers must encode late errors in the body once the response starts.
 */
export function hostedJsonReply(
    res: Response,
    throughTunnel: boolean,
    { escapeHtml = true }: { escapeHtml?: boolean } = {}
) {
    if (!throughTunnel)
        return (body: unknown, status = 200) => res.status(status).json(body);

    const heartbeat = setInterval(() => {
        if (res.destroyed || res.writableNeedDrain) return;
        if (!res.headersSent) {
            res.type('json').set({
                'Cache-Control': 'no-store, no-transform',
                'X-Content-Type-Options': 'nosniff',
                'X-IPTVnator-JSON-Heartbeat': '1',
            });
        }
        res.write('\n');
    }, 10_000);
    heartbeat.unref();
    res.once('close', () => clearInterval(heartbeat));

    return (body: unknown, status = 200) => {
        clearInterval(heartbeat);
        if (!res.headersSent) return res.status(status).json(body);
        const json = JSON.stringify(body);
        return res.end(
            escapeHtml
                ? json
                      .replace(/</g, '\\u003c')
                      .replace(/>/g, '\\u003e')
                      .replace(/&/g, '\\u0026')
                : json
        );
    };
}
