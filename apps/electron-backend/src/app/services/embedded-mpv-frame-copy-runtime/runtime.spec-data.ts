export const SUCCESS_OUTPUT =
    '{"protocol":1,"usable":true,"libmpv":"2.3","renderApi":"egl"}\n';

export const EXTERNAL_SYSTEM_LIBRARIES = [
    {
        name: 'libEGL.so.1',
        interface: 'EGL',
        reason: 'System graphics-driver interface used by the frame-copy helper.',
    },
    {
        name: 'libGL.so.1',
        interface: 'OpenGL',
        reason: 'System OpenGL compatibility interface supplied by the graphics stack.',
    },
    {
        name: 'libGLX.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL dispatch interface supplied by the graphics stack.',
    },
    {
        name: 'libOpenGL.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL interface supplied by the graphics stack.',
    },
    {
        name: 'libasound.so.2',
        interface: 'ALSA',
        reason: 'Linux system audio interface intentionally used by libmpv.',
    },
    {
        name: 'libdrm.so.2',
        interface: 'DRM',
        reason: 'Kernel graphics interface used by system GBM and VA-API drivers.',
    },
    {
        name: 'libgbm.so.1',
        interface: 'GBM',
        reason: 'System graphics-buffer interface used by headless EGL rendering.',
    },
    {
        name: 'libpulse.so.0',
        interface: 'PulseAudio',
        reason: 'Linux desktop audio interface intentionally used by libmpv.',
    },
    {
        name: 'libva-drm.so.2',
        interface: 'VA-API DRM',
        reason: 'System VA-API DRM interface used for hardware decoding.',
    },
    {
        name: 'libva.so.2',
        interface: 'VA-API',
        reason: 'System video-acceleration interface used for hardware decoding.',
    },
];

export const PINNED_SOURCE_PACKAGE_IDENTITIES = {
    freetype: {
        version: '2.13.3',
        sourceUrl:
            'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
        sourceSha256:
            '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
        license: 'FreeType License (FTL)',
    },
    fribidi: {
        version: '1.0.16',
        sourceUrl:
            'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
        sourceSha256:
            '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
        license: 'LGPL-2.1-or-later',
    },
    harfbuzz: {
        version: '8.5.0',
        sourceUrl:
            'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
        sourceSha256:
            '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
        license: 'MIT',
    },
    expat: {
        version: '2.8.2',
        sourceUrl:
            'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz',
        sourceSha256:
            '3ad89b8588e6644bd4e49981480d48b21289eebbcd4f0a1a4afb1c29f99b6ab4',
        license: 'MIT',
    },
    fontconfig: {
        version: '2.16.0',
        sourceUrl:
            'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz',
        sourceSha256:
            '6a33dc555cc9ba8b10caf7695878ef134eeb36d0af366041f639b1da9b6ed220',
        license: 'MIT',
    },
    libass: {
        version: '0.17.3',
        sourceUrl:
            'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
        sourceSha256:
            'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        license: 'ISC',
    },
    openssl: {
        version: '3.5.7',
        sourceUrl:
            'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz',
        sourceSha256:
            'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8',
        license: 'Apache-2.0',
    },
    ffmpeg: {
        version: '8.1',
        sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
        sourceSha256:
            'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
        license: 'LGPL-2.1-or-later',
    },
    libplacebo: {
        version: '7.360.1',
        sourceUrl: 'https://github.com/haasn/libplacebo.git',
        sourceTag: 'v7.360.1',
        sourceGitCommit: 'cee9b076f2c63104ccfd497fa79c39a867293ec4',
        license: 'LGPL-2.1-or-later',
    },
    hwdata: {
        version: '0.409',
        sourceUrl:
            'https://github.com/vcrhonek/hwdata/archive/refs/tags/v0.409.tar.gz',
        sourceSha256:
            '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
        buildInput: {
            consumer: 'libdisplay-info',
            relativePath: 'pnp.ids',
            purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
        },
        license: 'GPL-2.0-or-later OR XFree86-1.0',
    },
    'libdisplay-info': {
        version: '0.1.1',
        sourceUrl:
            'https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.1.1/downloads/libdisplay-info-0.1.1.tar.xz',
        sourceSha256:
            '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
        license: 'MIT',
    },
    mpv: {
        version: '0.41.0',
        sourceUrl:
            'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
        sourceSha256:
            'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
        license: 'LGPL-2.1-or-later with -Dgpl=false',
    },
};

export interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

export interface RuntimeFixture {
    nativeDir: string;
    helperPath: string;
    manifestPath: string;
    manifest: Record<string, unknown>;
    runtimeContents: Record<string, Buffer>;
}
