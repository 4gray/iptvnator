import type { IncomingMessage } from 'node:http';

// Only the dedicated listener can mark a request; client headers cannot do so.
const ingress = new WeakMap<IncomingMessage, string>();
export function markHostedIngress(
    request: IncomingMessage,
    origin: string
): void {
    ingress.set(request, origin);
}
export function hostedIngressOrigin(
    request: IncomingMessage
): string | undefined {
    return ingress.get(request);
}
export interface HostedIngressState {
    origin: string;
}

const lan = new WeakMap<IncomingMessage, string>();
export function markHostedLan(request: IncomingMessage, origin: string): void {
    lan.set(request, origin);
}
export function hostedLanOrigin(request: IncomingMessage): string | undefined {
    return lan.get(request);
}

export const hostedWorkerSockets = new WeakSet<object>();

export function isHostedWorkerRequest(request: IncomingMessage): boolean {
    return hostedWorkerSockets.has(request.socket);
}
