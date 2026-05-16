#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const TEXT_EXTENSIONS = new Set([
    '.astro',
    '.bat',
    '.cjs',
    '.conf',
    '.css',
    '.csv',
    '.editorconfig',
    '.env',
    '.gitignore',
    '.html',
    '.ini',
    '.js',
    '.json',
    '.jsonc',
    '.less',
    '.md',
    '.mjs',
    '.ps1',
    '.scss',
    '.sh',
    '.svg',
    '.ts',
    '.tsx',
    '.txt',
    '.xml',
    '.yaml',
    '.yml',
]);

const SKIP_NAMES = new Set([
    'pnpm-lock.yaml',
]);

const SKIP_CONTENT_SCAN_PATHS = [
    'tools/diagnostics/push-safety-check.js',
];

const PRIVATE_PATHS = [
    /^\.secrets\//,
    /^\.local\//,
    /^\.tmp\//,
    /^\.env(?:$|\.)/,
    /(?:^|\/)[^/]*\.local\.json$/,
    /(?:^|\/)[^/]*\.secret\.[^/]+$/,
    /(?:^|\/)[^/]*\.credential\.[^/]+$/,
    /(?:^|\/)[^/]*\.bak$/,
    /(?:^|\/)[^/]*\.db$/,
    /(?:^|\/)[^/]*\.sqlite3?$/,
];

const CONTENT_PATTERNS = [
    {
        label: 'absolute Windows user path',
        regex: /\b[A-Z]:\\Users\\[^\\\r\n"']+/i,
    },
    {
        label: 'Xtream URL with embedded credentials',
        regex: /https?:\/\/[^\s"'`]+\/(?:player_api|get)\.php\?(?=[^\s"'`]*(?:username|password)=)[^\s"'`]*/i,
        allowMatch: (match) => /https?:\/\/localhost(?::(?:\d+|\$\{PORT\}))?\/player_api\.php\?username=(?:user1|epg)&password=(?:pass1|epg)/i.test(match),
    },
    {
        label: 'URL with username/password authority',
        regex: /https?:\/\/[^/\s"'`]+:[^@\s"'`]+@/i,
    },
    {
        label: 'numeric private IPTV-like host',
        regex: /\b\d{9,}\.[a-z0-9-]+\.(?:com|net|org|tv)\b/i,
    },
];

function gitListFiles(args) {
    const output = execFileSync('git', args, {
        cwd: ROOT,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    return output
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((item) => item.replace(/\\/g, '/'));
}

function isTextFile(relativePath) {
    if (SKIP_CONTENT_SCAN_PATHS.some((prefix) => relativePath.startsWith(prefix))) {
        return false;
    }

    const basename = path.basename(relativePath);
    if (SKIP_NAMES.has(basename)) {
        return false;
    }

    const extension = path.extname(relativePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
        return true;
    }

    return basename.startsWith('.') && TEXT_EXTENSIONS.has(basename);
}

function findLine(content, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (content.charCodeAt(i) === 10) {
            line += 1;
        }
    }
    return line;
}

function main() {
    const files = gitListFiles(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    const findings = [];

    for (const relativePath of files) {
        const absolutePath = path.join(ROOT, relativePath);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        for (const pattern of PRIVATE_PATHS) {
            if (pattern.test(relativePath)) {
                findings.push({
                    label: 'private/local artifact is committable',
                    path: relativePath,
                    line: 1,
                });
                break;
            }
        }

        if (!isTextFile(relativePath)) {
            continue;
        }

        let content;
        try {
            content = fs.readFileSync(absolutePath, 'utf8');
        } catch {
            continue;
        }

        for (const pattern of CONTENT_PATTERNS) {
            const flags = pattern.regex.flags.includes('g')
                ? pattern.regex.flags
                : `${pattern.regex.flags}g`;
            const globalRegex = new RegExp(pattern.regex.source, flags);

            for (const match of content.matchAll(globalRegex)) {
                if (pattern.allowMatch && pattern.allowMatch(match[0], relativePath)) {
                    continue;
                }

                findings.push({
                    label: pattern.label,
                    path: relativePath,
                    line: findLine(content, match.index),
                });
                break;
            }
        }
    }

    if (findings.length > 0) {
        console.error('Push safety check failed. Review these private-data risks before pushing:');
        for (const finding of findings) {
            console.error(`- ${finding.label}: ${finding.path}:${finding.line}`);
        }
        process.exit(1);
    }

    console.log(`Push safety check passed (${files.length} committable files scanned).`);
}

main();
