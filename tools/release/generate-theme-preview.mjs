#!/usr/bin/env node
/** Compose an additional theme preview from unchanged, matching app captures. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validateReleaseSlug } from './screenshot-guards.mjs';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

export function parseThemePreviewArguments(args, version) {
    const options = {
        release: `v${version.split('.').slice(0, 2).join('-')}`,
        shot: 'dashboard-live-channels',
        split: 'diagonal',
    };
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index]?.slice(2);
        const value = args[index + 1];
        if (
            !args[index]?.startsWith('--') ||
            !Object.hasOwn(options, name) ||
            !value ||
            value.startsWith('--')
        )
            throw new Error(
                'Use --release <slug>, --shot <slug>, --split diagonal|vertical'
            );
        options[name] = value;
    }
    if (
        validateReleaseSlug(options.release) ||
        validateReleaseSlug(options.shot)
    )
        throw new Error(
            'Release and screenshot names must be plain lowercase slugs'
        );
    if (!['diagonal', 'vertical'].includes(options.split))
        throw new Error('--split must be diagonal or vertical');
    return options;
}

/** Same geometry, original source pixels, opaque 50/50 area and one sharp seam. */
export async function composeThemePreview(light, dark, split = 'diagonal') {
    if (!['diagonal', 'vertical'].includes(split))
        throw new Error('Unknown theme split');
    const [lightMeta, darkMeta] = await Promise.all([
        sharp(light).metadata(),
        sharp(dark).metadata(),
    ]);
    const { width, height } = lightMeta;
    if (
        !width ||
        !height ||
        width !== darkMeta.width ||
        height !== darkMeta.height
    )
        throw new Error(
            'Theme captures must have identical dimensions; no resizing is applied'
        );
    const topCut = width * (split === 'diagonal' ? 0.4 : 0.5);
    const bottomCut = width - topCut;
    const mask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${topCut},0 ${width},0 ${width},${height} ${bottomCut},${height}" fill="white"/></svg>`
    );
    const darkHalf = await sharp(dark)
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    const png = await sharp(light)
        .composite([{ input: darkHalf }])
        .png({ compressionLevel: 9 })
        .toBuffer();
    return { png, width, height, split, topCut, bottomCut };
}

export async function generateThemePreview(options, root = workspaceRoot) {
    const releaseRoot = path.join(
        root,
        'apps/website/public/blog',
        options.release
    );
    const relativeSource = (theme) =>
        `screenshots/${options.shot}-${theme}.png`;
    let light;
    let dark;
    try {
        light = readFileSync(path.join(releaseRoot, relativeSource('light')));
        dark = readFileSync(path.join(releaseRoot, relativeSource('dark')));
    } catch {
        throw new Error(
            `Capture both themes first: pnpm release:screenshots --cinematic --release ${options.release} --only ${options.shot}`
        );
    }
    const result = await composeThemePreview(light, dark, options.split);
    const webp = await sharp(result.png)
        .webp({ lossless: true, effort: 6 })
        .toBuffer();
    const outputRoot = path.join(releaseRoot, 'previews');
    const name = `${options.shot}-themes-${options.split}`;
    const digest = (data) => createHash('sha256').update(data).digest('hex');
    const manifest = {
        version: 1,
        composition:
            'original screenshot pixels; light on the left, dark on the right',
        width: result.width,
        height: result.height,
        split: result.split,
        topCut: result.topCut,
        bottomCut: result.bottomCut,
        sources: ['light', 'dark'].map((theme) => ({
            theme,
            file: `../${relativeSource(theme)}`,
            sha256: digest(theme === 'light' ? light : dark),
        })),
        outputs: [
            { file: `${name}.png`, sha256: digest(result.png) },
            { file: `${name}.webp`, sha256: digest(webp) },
        ],
    };
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(path.join(outputRoot, `${name}.png`), result.png);
    writeFileSync(path.join(outputRoot, `${name}.webp`), webp);
    writeFileSync(
        path.join(outputRoot, `${name}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
    return { outputRoot, name, width: result.width, height: result.height };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        const version = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
        ).version;
        const result = await generateThemePreview(
            parseThemePreviewArguments(process.argv.slice(2), version)
        );
        console.log(
            `Theme preview: ${path.relative(workspaceRoot, result.outputRoot)}/${result.name}.{png,webp} (${result.width}×${result.height})`
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
