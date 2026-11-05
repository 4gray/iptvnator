import { accessSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Check saved build outputs before starting an isolated capture or preview. */
export function assertBuiltRuntime(
    workspaceRoot: string,
    electronMainPath: string
): void {
    for (const required of [
        electronMainPath,
        path.join(workspaceRoot, 'dist/apps/web/index.html'),
    ]) {
        try {
            accessSync(required);
        } catch {
            throw new Error(
                `Built runtime missing: ${required}\nBuild it first: pnpm nx run electron-backend:build-e2e`
            );
        }
    }
}

export function readAppVersion(): string {
    return JSON.parse(
        readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ).version;
}
