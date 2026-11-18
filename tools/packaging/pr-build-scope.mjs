import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// Skip only known application-only inputs; new build inputs keep packaging on.
function needsPackaging(file) {
    if (/[\r\n]/.test(file)) return true;
    if (
        /\.md$/.test(file) ||
        /^(docs|\.plans|\.changes|\.agents|\.codex|\.claude)\//.test(file)
    )
        return false;
    if (/(^|\/)(package\.json|project\.json|tsconfig[^/]*\.json)$/.test(file))
        return true;
    if (
        /^apps\/(website|tv|tv-e2e|tv-setup|web-e2e|electron-backend-e2e|stalker-mock-server|xtream-mock-server)\//.test(
            file
        )
    )
        return false;
    if (
        /^apps\/electron-backend\//.test(file) ||
        /^libs\/shared\/database\//.test(file) ||
        /(^|[/._-])(electron|native|embedded-mpv)([/._-]|$)/.test(file)
    )
        return true;
    return !(
        /^apps\/(web|web-backend|remote-control-web)\/src\//.test(file) ||
        /^libs\/.*\/src\//.test(file)
    );
}

let checkWebsite = false;
let packaging = true;
try {
    const files = execFileSync(
        'git',
        [
            'diff',
            '--name-only',
            '-z',
            '--no-renames',
            '--ignore-submodules=none',
            'HEAD^1',
            'HEAD',
            '--',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
        .split('\0')
        .filter(Boolean);
    packaging = files.length === 0 || files.some(needsPackaging);
    checkWebsite =
        !packaging && files.some((file) => file.startsWith('apps/website/'));
} catch {
    console.warn(
        '::warning::Could not compare the PR merge tree; running packaging.'
    );
}
appendFileSync(
    process.env.GITHUB_OUTPUT,
    `check-website=${checkWebsite}\npackaging=${packaging}\n`
);
appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Electron packaging: **${packaging ? 'selected' : 'skipped'}**. ` +
        'Manual builds remain available through build-and-make.yaml.\n'
);
