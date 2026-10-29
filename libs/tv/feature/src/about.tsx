import {
    detectTvPlatform,
    formatBuildTimestamp,
    tvBuildInfo,
    tvDeveloperInfo,
    tvLicenceInfo,
} from './build-info';

export function AboutDeveloper() {
    const platform =
        typeof navigator === 'undefined'
            ? { platform: 'Browser runtime', runtime: 'Browser runtime' }
            : detectTvPlatform(
                  navigator.userAgent ?? '',
                  typeof window !== 'undefined' &&
                      ('webOS' in window || 'PalmSystem' in window)
              );

    return (
        <div class="about-information">
            <section class="about-section">
                <h2>Application</h2>
                <dl class="about-details">
                    <div>
                        <dt>App name</dt>
                        <dd>{tvBuildInfo.name}</dd>
                    </div>
                    <div>
                        <dt>Version</dt>
                        <dd>{tvBuildInfo.version}</dd>
                    </div>
                    <div>
                        <dt>Build identifier</dt>
                        <dd class="about-mono">{tvBuildInfo.buildId}</dd>
                    </div>
                    <div>
                        <dt>Build timestamp</dt>
                        <dd>{formatBuildTimestamp(tvBuildInfo.buildTimestamp)}</dd>
                    </div>
                    <div>
                        <dt>Git commit</dt>
                        <dd class="about-mono">{tvBuildInfo.gitCommit}</dd>
                    </div>
                    <div>
                        <dt>Platform</dt>
                        <dd>{platform.platform}</dd>
                    </div>
                    <div>
                        <dt>Runtime</dt>
                        <dd>{platform.runtime}</dd>
                    </div>
                </dl>
            </section>

            <section class="about-section">
                <h2>Developer</h2>
                <dl class="about-details">
                    <div>
                        <dt>Name</dt>
                        <dd>{tvDeveloperInfo.name}</dd>
                    </div>
                    <div>
                        <dt>Email</dt>
                        <dd>{tvDeveloperInfo.email}</dd>
                    </div>
                    <div>
                        <dt>Website</dt>
                        <dd>{tvDeveloperInfo.website}</dd>
                    </div>
                    <div>
                        <dt>Support</dt>
                        <dd>{tvDeveloperInfo.support}</dd>
                    </div>
                </dl>
            </section>

            <section class="about-section">
                <h2>Licence and attribution</h2>
                <dl class="about-details">
                    <div>
                        <dt>Licence</dt>
                        <dd>{tvLicenceInfo.licence}</dd>
                    </div>
                    <div>
                        <dt>Copyright</dt>
                        <dd>{tvLicenceInfo.copyright}</dd>
                    </div>
                </dl>
                <p class="muted">{tvLicenceInfo.projectTrademark}</p>
                <p class="muted">
                    This application uses Preact. Its licence and third-party
                    notice information remain subject to the packaged dependency
                    metadata and repository licence.
                </p>
            </section>
        </div>
    );
}
