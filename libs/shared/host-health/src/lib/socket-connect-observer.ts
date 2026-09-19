import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';

/**
 * The one method every Node HTTP/HTTPS agent funnels a request through, pooled
 * socket or fresh connection alike. `@types/node` leaves it undeclared, so the
 * shape is spelled out here rather than reached through `any`.
 */
interface RequestAcceptingAgent {
    addRequest(request: ClientRequest, ...rest: unknown[]): void;
}

/**
 * Reports the moment the TCP connection carrying `request` is known to be
 * established. A keep-alive agent can hand the request a socket whose
 * `connect` event fired long ago, so a socket that is no longer connecting
 * counts right away: the host DID accept a connection, which is the fact
 * wanted. A socket that never connects (refused, unresolvable, unanswered
 * SYN) never reports.
 */
export function observeRequestSocketConnect(
    request: ClientRequest,
    onConnect: () => void
): void {
    request.once('socket', (socket: Socket) => {
        if (socket.connecting) {
            socket.once('connect', onConnect);
        } else {
            onConnect();
        }
    });
}

/**
 * {@link observeRequestSocketConnect} for a transport that never hands its
 * `ClientRequest` back (axios' default adapter): hooking the agent's
 * `addRequest` sees every request the agent takes, pooled or fresh.
 *
 * Mutates and returns the same agent so it can be passed straight into an
 * axios config. Never install this on a shared agent such as
 * `http.globalAgent`: the callback belongs to one request, and a second
 * install on the same agent stacks on the first rather than replacing it.
 */
export function observeAgentSocketConnections<TAgent extends object>(
    agent: TAgent,
    onConnect: () => void
): TAgent {
    const target = agent as unknown as RequestAcceptingAgent;
    const original = target.addRequest;
    target.addRequest = function observedAddRequest(
        this: RequestAcceptingAgent,
        request: ClientRequest,
        ...rest: unknown[]
    ): void {
        observeRequestSocketConnect(request, onConnect);
        return original.call(this, request, ...rest);
    };
    return agent;
}
