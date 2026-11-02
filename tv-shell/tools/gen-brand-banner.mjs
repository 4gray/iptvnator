/** Render the Android TV launcher banner using the shared IPTVnator icon. */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const icon = await readFile(
    new URL(
        '../../apps/web/src/assets/icons/android-chrome-192x192.png',
        import.meta.url
    )
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="#1b1c1c"/>
    <image href="data:image/png;base64,${icon.toString('base64')}" x="18" y="42" width="96" height="96"/>
    <text x="124" y="88" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="29" font-weight="700">IPTVnator</text>
    <text x="125" y="111" fill="#b7b9bb" font-family="Arial, sans-serif" font-size="13">Android TV · Fire TV</text>
</svg>`;
const banner = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(
    new URL('../android/app/src/main/res/drawable/banner.png', import.meta.url),
    banner
);
