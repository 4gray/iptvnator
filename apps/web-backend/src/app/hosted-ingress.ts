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
