import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stageTizenPackage } from './tizen-package.mjs';

const profile = process.env.TIZEN_SIGNING_PROFILE;
if (!profile?.trim())
    throw new Error(
        'Set TIZEN_SIGNING_PROFILE to a local Samsung TV certificate profile.'
    );
const input = stageTizenPackage(process.cwd());
const args = ['package', '-t', 'wgt', '-s', profile, '--', input];
// Tizen Studio provides a batch entry point on Windows. Reject cmd expansion
// characters and quote arguments, including paths and profiles containing spaces.
if (
    process.platform === 'win32' &&
    args.some((arg) => /["%\r\n!^&|<>]/.test(arg))
)
    throw new Error(
        'Tizen CLI arguments contain unsupported Windows shell characters.'
    );
const packaged = spawnSync(
    process.platform === 'win32' ? 'tizen.bat' : 'tizen',
    process.platform === 'win32' ? args.map((arg) => '"' + arg + '"') : args,
    {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    }
);
if (packaged.error) throw packaged.error;
if (packaged.status !== 0) process.exit(packaged.status ?? 1);

const widgets = readdirSync(input).filter((file) => file.endsWith('.wgt'));
if (widgets.length !== 1)
    throw new Error(
        'Tizen CLI must emit exactly one WGT in the staged input directory.'
    );
const output = 'dist/tv-tizen-package';
mkdirSync(output, { recursive: true });
copyFileSync(join(input, widgets[0]), join(output, widgets[0]));
