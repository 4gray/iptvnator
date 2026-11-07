import {
    cpSync,
    existsSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { verifyTvBundle } from './build-check.mjs';

export const tizenInput = 'dist/tv-tizen-input';
const samsungApiScript = '<script src="$WEBAPIS/webapis/webapis.js"></script>';

export function stageTizenPackage(workspace) {
    const build = resolve(workspace, 'dist/apps/tv');
    const input = resolve(workspace, tizenInput);
    const app = JSON.parse(readFileSync(build + '/appinfo.json', 'utf8'));
    // The staging directory is fixed under this workspace; never mutate the LG input.
    rmSync(input, { recursive: true, force: true });
    cpSync(build, input, {
        recursive: true,
        filter: (file) =>
            !['appinfo.json', 'large-icon.png'].includes(
                file.split(/[\\/]/).pop()
            ),
    });
    const template = readFileSync(
        resolve(workspace, 'apps/tv/tizen/config.xml'),
        'utf8'
    );
    writeFileSync(
        input + '/config.xml',
        template.replace('__TV_VERSION__', app.version)
    );
    const html = readFileSync(input + '/index.html', 'utf8');
    writeFileSync(
        input + '/index.html',
        html.replace('<head>', '<head>\n' + samsungApiScript)
    );
    verifyTizenPackage(input);
    return input;
}

export function verifyTizenPackage(input) {
    const bytes = verifyTvBundle(input);
    const html = readFileSync(input + '/index.html', 'utf8');
    assert.ok(
        html.includes(samsungApiScript) &&
            html.indexOf(samsungApiScript) < html.indexOf('<script defer'),
        'Tizen input must load the Samsung SDK before the application'
    );
    assert.equal(
        existsSync(input + '/appinfo.json'),
        false,
        'Tizen input must exclude LG metadata'
    );
    const dom = new JSDOM(readFileSync(input + '/config.xml', 'utf8'), {
        contentType: 'application/xml',
    });
    try {
        const xml = dom.window.document;
        const application = xml.getElementsByTagNameNS(
            'http://tizen.org/ns/widgets',
            'application'
        )[0];
        assert.equal(
            xml.documentElement.namespaceURI,
            'http://www.w3.org/ns/widgets'
        );
        assert.match(
            xml.documentElement.getAttribute('version'),
            /^\d+\.\d+\.\d+$/
        );
        assert.match(application.getAttribute('package'), /^[A-Za-z0-9]{10}$/);
        assert.ok(
            application
                .getAttribute('id')
                .startsWith(application.getAttribute('package') + '.')
        );
        assert.equal(application.getAttribute('required_version'), '5.5');
        assert.equal(
            xml.querySelector('content')?.getAttribute('src'),
            'index.html'
        );
        assert.equal(
            xml.querySelector('icon')?.getAttribute('src'),
            'icon.png'
        );
        assert.ok(
            existsSync(input + '/icon.png'),
            'Tizen input must include the shared icon'
        );
        assert.deepEqual(
            Array.from(
                xml.getElementsByTagNameNS(
                    'http://tizen.org/ns/widgets',
                    'privilege'
                ),
                (element) => element.getAttribute('name')
            ).sort(),
            [
                'http://tizen.org/privilege/internet',
                'http://tizen.org/privilege/tv.inputdevice',
            ]
        );
        assert.equal(
            xml
                .getElementsByTagNameNS(
                    'http://tizen.org/ns/widgets',
                    'profile'
                )[0]
                ?.getAttribute('name'),
            'tv-samsung'
        );
        assert.equal(xml.querySelector('access')?.getAttribute('origin'), '*');
    } finally {
        dom.window.close();
    }
    return bytes;
}
