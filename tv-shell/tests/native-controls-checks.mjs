import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';

export function createNativeControlFixtures(directory, mp4, subtitles) {
    for (const [name, options] of [['high', ['-c:v', 'copy']], ['low', ['-vf', 'scale=160:90', '-c:v', 'libx264', '-g', '25']]]) {
        execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-stream_loop', '2', '-i', mp4,
            ...options, '-c:a', 'copy', '-hls_time', '2', '-hls_list_size', '0',
            join(directory, `synthetic-controls-${name}.m3u8`)]);
    }
    writeFileSync(join(directory, 'synthetic-controls.m3u8'), [
        '#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90',
        'synthetic-controls-low.m3u8', '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x180',
        'synthetic-controls-high.m3u8', '',
    ].join('\n'));
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', mp4, '-i', subtitles,
        '-map', '0:v', '-map', '0:a', '-map', '0:a', '-map', '1:s',
        '-c:v', 'copy', '-c:a', 'aac', '-metadata:s:a:0', 'language=eng',
        '-metadata:s:a:1', 'language=fra', '-metadata:s:s:0', 'language=eng',
        '-disposition:s:0', '0', join(directory, 'synthetic-controls.mkv')]);
}

export async function checkNativeControls({ adb, dumpLayout, page, origin, topActivity }) {
    const native = '.ui.NativePlayerActivity';
    const nodeById = (layout, id) => layout.match(new RegExp(`<node [^>]*resource-id="[^\"]*:id/${id}"[^>]*>`))?.[0];
    const nodeByText = (layout, text) => {
        const pattern = new RegExp(`^${text}$`);
        return layout.match(/<node [^>]*>/g)?.find(node => pattern.test(node.match(/\btext="([^\"]*)"/)?.[1] ?? ''));
    };
    const tap = (node) => {
        assert.ok(node, 'The native control must be present.');
        const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
        adb('shell', 'input', 'tap', String((bounds[0] + bounds[2]) / 2), String((bounds[1] + bounds[3]) / 2));
    };
    async function open(id) {
        await expect.poll(() => {
            const layout = dumpLayout();
            const node = nodeById(layout, id);
            if (!node) {
                const back = nodeById(layout, 'native_back');
                if (!back) {
                    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_UP');
                } else {
                    const [, , top, , bottom] = back.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
                    const width = Number(adb('shell', 'wm', 'size').match(/(\d+)x\d+/)[1]);
                    const toEnd = id === 'native_quality' || id === 'native_picture';
                    adb('shell', 'input', 'swipe', String(width * (toEnd ? 0.8 : 0.2)), String((+top + +bottom) / 2),
                        String(width * (toEnd ? 0.2 : 0.8)), String((+top + +bottom) / 2), '150');
                }
            }
            return Boolean(node?.includes('enabled="true"'));
        }).toBe(true);
        tap(nodeById(dumpLayout(), id));
    }
    async function choose(text, confirm = false) {
        let node;
        await expect.poll(() => {
            node = nodeByText(dumpLayout(), text);
            return Boolean(node);
        }).toBe(true);
        tap(node);
        if (confirm) tap(nodeByText(dumpLayout(), 'OK'));
    }
    async function launch(path) {
        await page.evaluate((url) => {
            window.__controlsResult = undefined;
            window.addEventListener('iptvnator:android-playback-result', (event) => {
                window.__controlsResult = event.detail.result;
            }, { once: true });
            window.TvShell.postMessage(JSON.stringify(['playNative', crypto.randomUUID(), { url }]));
        }, origin + path);
        await expect.poll(topActivity).toContain(native);
        const pid = adb('shell', 'pidof', 'org.tvshell.iptvnator').trim();
        await expect.poll(() => adb('shell', 'dumpsys', 'audio').split('\n').some((line) =>
            line.includes('type:android.media.AudioTrack') && line.includes(`/${pid} state:started`)
        ), { timeout: 10000 }).toBe(true);
        adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
    }
    async function leave() {
        await open('native_back');
        await expect.poll(topActivity).toContain('.ui.MainActivity');
        await page.waitForFunction(() => window.__controlsResult !== undefined);
        assert.equal(await page.evaluate(() => window.__controlsResult.ended), false);
    }
    async function expectPictureRatio(ratio, message) {
        await expect.poll(() => {
            // Read laid-out video bounds even though the frame is omitted from the accessibility tree.
            const frame = adb('shell', 'dumpsys', 'activity', 'top').match(
                /(-?\d+),(-?\d+)-(-?\d+),(-?\d+) #[\da-f]+ \S*:id\/exo_content_frame\}/
            );
            if (!frame) return 0;
            const [, left, top, right, bottom] = frame.map(Number);
            return (right - left) / (bottom - top);
        }, { message }).toBeCloseTo(ratio, 2);
    }

    console.log('Checking Media3 audio, subtitles, picture and touch Back');
    await launch('/synthetic-controls.mkv');
    await open('native_audio');
    await choose('French.*', true);
    await open('native_audio');
    assert.match(nodeByText(dumpLayout(), 'French.*'), /checked="true"/);
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    assert.ok(topActivity().includes(native), 'Back closes the track dialog before leaving playback.');
    await open('native_subtitles');
    await choose('English.*', true);
    await expect.poll(() => nodeById(dumpLayout(), 'native_subtitles')).toMatch(/selected="true"/);
    await open('native_subtitles');
    await choose('None', true);
    await expect.poll(() => nodeById(dumpLayout(), 'native_subtitles')).toMatch(/selected="false"/);
    await open('native_subtitles');
    assert.match(nodeByText(dumpLayout(), 'None'), /checked="true"/);
    await choose('OK');
    await expect.poll(() => nodeById(dumpLayout(), 'native_subtitles')).toMatch(/selected="false"/);
    await open('native_subtitles');
    await choose('English.*', true);
    await open('native_quality');
    assert.ok(nodeByText(dumpLayout(), 'Original'));
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await expectPictureRatio(16 / 9, 'Fit displays the source aspect ratio.');
    await open('native_picture');
    await choose('4:3');
    await expectPictureRatio(4 / 3, 'Changing to 4:3 resizes the video frame.');

    const rotation = adb('shell', 'settings', 'get', 'system', 'user_rotation').trim();
    const autoRotation = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').trim();
    const lastCreate = () => adb('logcat', '-b', 'events', '-d', '-v', 'epoch', '-s', 'wm_on_create_called')
        .split('\n').findLast(line => line.includes('org.tvshell.iptvnator.ui.NativePlayerActivity')) ?? '';
    try {
        const previousCreate = lastCreate();
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
        adb('shell', 'settings', 'put', 'system', 'user_rotation', rotation === '0' ? '1' : '0');
        await expect.poll(lastCreate).not.toBe(previousCreate);
        await expectPictureRatio(4 / 3, 'Rotating keeps the video frame at 4:3.');
        await open('native_audio');
        await expect.poll(() => nodeByText(dumpLayout(), 'French.*')).toMatch(/checked="true"/);
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
        await leave();
    } finally {
        adb('shell', 'settings', 'put', 'system', 'user_rotation', rotation);
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', autoRotation);
    }

    console.log('Checking Media3 HLS quality overrides and Auto');
    await launch('/synthetic-controls.m3u8');
    await open('native_quality');
    assert.ok(nodeByText(dumpLayout(), 'Auto'));
    await choose('160.*90.*', true);
    await open('native_quality');
    assert.match(nodeByText(dumpLayout(), '160.*90.*'), /checked="true"/);
    await choose('320.*180.*', true);
    await open('native_quality');
    assert.match(nodeByText(dumpLayout(), '320.*180.*'), /checked="true"/);
    await choose('Auto', true);
    await open('native_quality');
    assert.match(nodeByText(dumpLayout(), 'Auto'), /checked="true"/);
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await expect.poll(() => {
        const focused = /resource-id="[^\"]*:id\/native_(back|audio|subtitles|quality|picture|mute)"[^>]*focused="true"/;
        if (focused.test(dumpLayout())) return true;
        adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_UP');
        return false;
    }, { timeout: 15000, message: 'The remote can reach the native toolbar with Up.' }).toBe(true);
    adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN');
    await expect.poll(() => nodeById(dumpLayout(), 'exo_play_pause')).toMatch(/focused="true"/);
    await leave();
    console.log('PASS Media3 audio, subtitles, quality overrides and Auto, single-quality source, picture rotation and touch Back');
}
