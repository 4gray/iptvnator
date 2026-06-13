import { resolve } from 'node:path';

const MAX_AUTHORIZED_WRITE_PATHS = 32;

export class PlaylistWriteAuthorizer {
    private readonly pathsBySender = new Map<number, Set<string>>();

    authorize(senderId: number, filePath: string): void {
        const senderPaths =
            this.pathsBySender.get(senderId) ?? new Set<string>();
        senderPaths.add(resolve(filePath));
        this.pathsBySender.set(senderId, senderPaths);

        while (senderPaths.size > MAX_AUTHORIZED_WRITE_PATHS) {
            const oldest = senderPaths.values().next().value;
            if (oldest === undefined) {
                break;
            }
            senderPaths.delete(oldest);
        }
    }

    consume(senderId: number, filePath: string): string {
        const normalizedPath = resolve(String(filePath ?? ''));
        const senderPaths = this.pathsBySender.get(senderId);
        if (!senderPaths?.delete(normalizedPath)) {
            throw new Error(
                'Refusing to write to a path not authorized by a save dialog'
            );
        }
        if (senderPaths.size === 0) {
            this.pathsBySender.delete(senderId);
        }
        return normalizedPath;
    }
}
