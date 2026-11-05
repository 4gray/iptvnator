import { useEffect, useState } from 'preact/hooks';

export interface TvBuildInfo {
    title: string;
    version: string;
    releaseVersion: string;
    appId: string;
    vendor: string;
    license: string;
    projectUrl: string;
    revision?: string;
    modified: boolean;
    builtAt: string;
}

export function About({ build }: { build: TvBuildInfo }) {
    const [viewport, setViewport] = useState(
        `${window.innerWidth} × ${window.innerHeight}`
    );
    useEffect(() => {
        const resize = () =>
            setViewport(`${window.innerWidth} × ${window.innerHeight}`);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1];
    const platform = /web0s|webos|netcast/i.test(navigator.userAgent)
        ? 'webOS TV'
        : 'Web browser';
    const application = [
        ['TV app version', build.version],
        ['IPTVnator release', build.releaseVersion],
        [
            'Revision',
            build.revision
                ? `${build.revision.slice(0, 12)}${build.modified ? ' · local changes' : ''}`
                : 'Not available',
        ],
        ['Built · UTC', build.builtAt.replace('T', ' ').replace(/\.\d+Z$/, '')],
        ['Application ID', build.appId],
    ];
    const runtime = [
        ['Platform', platform],
        ['Browser engine', chrome ? `Chromium ${chrome}` : 'Not available'],
        ['Viewport', `${viewport} px`],
        ['System language', navigator.language || 'Not available'],
    ];
    const groups: [string, string[][]][] = [
        ['Application', application],
        ['This device', runtime],
    ];
    return (
        <section class="about-page" aria-label="About IPTVnator TV">
            <h2>About {build.title}</h2>
            <p class="muted">
                An open-source IPTV player for your playlists and portals.
            </p>
            <div class="about-columns">
                {groups.map(([heading, rows]) => (
                    <section>
                        <h3>{heading}</h3>
                        <dl>
                            {rows.map(([label, value]) => (
                                <div class="about-row">
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
            <section class="about-project">
                <h3>Project & source code</h3>
                <p>{build.projectUrl}</p>
                <p class="muted">
                    {build.vendor} · {build.license} license
                </p>
            </section>
        </section>
    );
}
