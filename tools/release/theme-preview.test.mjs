import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
    composeThemePreview,
    parseThemePreviewArguments,
} from './generate-theme-preview.mjs';

const lightColor = [240, 244, 250, 255];
const darkColor = [16, 20, 28, 255];
const source = (color, width = 100, height = 60) =>
    sharp({
        create: {
            width,
            height,
            channels: 4,
            background: {
                r: color[0],
                g: color[1],
                b: color[2],
                alpha: color[3] / 255,
            },
        },
    })
        .png()
        .toBuffer();
const rgba = async (buffer) => sharp(buffer).ensureAlpha().raw().toBuffer();
const pixel = (data, x, y) => [
    ...data.subarray((y * 100 + x) * 4, (y * 100 + x + 1) * 4),
];

describe('theme preview composition', () => {
    it('keeps original pixels on both sides of a centered diagonal without resizing', async () => {
        const result = await composeThemePreview(
            await source(lightColor),
            await source(darkColor)
        );
        assert.equal(result.width, 100);
        assert.equal(result.height, 60);
        const data = await rgba(result.png);
        assert.deepEqual(pixel(data, 10, 30), lightColor);
        assert.deepEqual(pixel(data, 90, 30), darkColor);
        assert.deepEqual(pixel(data, 48, 2), darkColor);
        assert.deepEqual(pixel(data, 52, 57), lightColor);
    });

    it('splits equal theme areas with only the diagonal edge antialiased', async () => {
        const { png } = await composeThemePreview(
            await source(lightColor),
            await source(darkColor)
        );
        const data = await rgba(png);
        let lightPixels = 0;
        let darkPixels = 0;
        for (let index = 0; index < data.length; index += 4) {
            const color = [...data.subarray(index, index + 4)];
            if (color.every((value, channel) => value === lightColor[channel]))
                lightPixels++;
            if (color.every((value, channel) => value === darkColor[channel]))
                darkPixels++;
            assert.equal(data[index + 3], 255);
        }
        assert.ok(Math.abs(lightPixels - darkPixels) < 100);
        assert.ok(lightPixels + darkPixels >= 5900);
    });

    it('can produce a straight 50/50 split from the same captures', async () => {
        const { png } = await composeThemePreview(
            await source(lightColor),
            await source(darkColor),
            'vertical'
        );
        const data = await rgba(png);
        for (const y of [0, 30, 59]) {
            assert.deepEqual(pixel(data, 49, y), lightColor);
            assert.deepEqual(pixel(data, 50, y), darkColor);
        }
    });

    it('rejects mismatched source dimensions and unsupported layouts', async () => {
        await assert.rejects(
            composeThemePreview(
                await source(lightColor),
                await source(darkColor, 120)
            ),
            /identical dimensions/
        );
        await assert.rejects(
            composeThemePreview(
                await source(lightColor),
                await source(darkColor),
                'other'
            ),
            /Unknown theme split/
        );
    });
});

describe('theme preview CLI', () => {
    it('uses the current minor release and live dashboard by default', () => {
        assert.deepEqual(parseThemePreviewArguments([], '0.25.0'), {
            release: 'v0-25',
            shot: 'dashboard-live-channels',
            split: 'diagonal',
        });
        assert.equal(
            parseThemePreviewArguments(['--split', 'vertical'], '0.25.0').split,
            'vertical'
        );
    });

    it('rejects path traversal, unknown flags and missing values', () => {
        for (const args of [
            ['--release', '../private'],
            ['--shot', '../../personal'],
            ['--split', 'unknown'],
            ['--output', 'elsewhere'],
            ['--shot'],
        ]) {
            assert.throws(() => parseThemePreviewArguments(args, '0.25.0'));
        }
    });
});
