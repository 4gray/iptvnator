import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TvBuildInfo } from '@iptvnator/tv/feature';

export function tvBuildIdentity(root = process.cwd()) {
    try {
        const git = (args: string[]) =>
            execFileSync('git', args, {
                cwd: root,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        return {
            revision: git(['rev-parse', 'HEAD']),
            modified: !!git(['status', '--porcelain']),
        };
    } catch {
        return { revision: undefined, modified: false };
    }
}

export function tvBuildInfo(
    root = process.cwd(),
    builtAt = new Date().toISOString()
): TvBuildInfo {
    const read = (path: string) =>
        JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    const app = read('apps/tv/public/appinfo.json');
    const pkg = read('package.json');
    return {
        title: app.title,
        version: app.version,
        releaseVersion: pkg.version,
        appId: app.id,
        vendor: app.vendor,
        license: pkg.license,
        projectUrl: pkg.homepage,
        ...tvBuildIdentity(root),
        builtAt,
    };
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
    process.argv[2] === '--cache-key'
)
    console.log(JSON.stringify(tvBuildIdentity()));
