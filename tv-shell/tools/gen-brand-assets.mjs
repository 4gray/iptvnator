/** Generate the Android TV brand assets from the shared IPTVnator artwork. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const icons = new URL('../../apps/web/src/assets/icons/', import.meta.url);
const resources = new URL('../android/app/src/main/res/', import.meta.url);
const launcher = await readFile(new URL('android-chrome-512x512.png', icons));
const mark = await sharp(await readFile(new URL('icon-tv-256.png', icons)))
    .trim()
    .png()
    .toBuffer();

const sizes = { mdpi: 80, hdpi: 120, xhdpi: 160, xxhdpi: 240, xxxhdpi: 320 };
for (const [density, size] of Object.entries(sizes)) {
    const dir = new URL(`mipmap-${density}/`, resources);
    const square = await sharp(launcher).resize(size, size).png().toBuffer();
    const circle = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
    const round = await sharp(square).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
    await writeFile(new URL('ic_launcher.png', dir), square);
    await writeFile(new URL('ic_launcher_round.png', dir), round);
}

const drawables = new URL('drawable-nodpi/', resources);
await mkdir(drawables, { recursive: true });
await writeFile(new URL('iptvnator_mark.png', drawables), mark);
// 108 dp layers at 4x density with the mark inside the central 66 dp safe zone.
const foreground = await sharp(mark)
    .resize(256, 256, { fit: 'contain', background: '#00000000' })
    .extend({ top: 88, bottom: 88, left: 88, right: 88, background: '#00000000' })
    .png()
    .toBuffer();
await writeFile(new URL('iptvnator_launcher_foreground.png', drawables), foreground);

const bannerIcon = await readFile(new URL('android-chrome-192x192.png', icons));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="#1b1c1c"/>
    <image href="data:image/png;base64,${bannerIcon.toString('base64')}" x="18" y="42" width="96" height="96"/>
    <text x="124" y="88" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="29" font-weight="700">IPTVnator</text>
    <text x="125" y="111" fill="#b7b9bb" font-family="Arial, sans-serif" font-size="13">Android TV · Fire TV</text>
</svg>`;
const banner = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(
    new URL('drawable/banner.png', resources),
    banner
);
