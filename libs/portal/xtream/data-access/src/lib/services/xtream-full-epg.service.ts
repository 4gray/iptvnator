import { inject, Injectable } from '@angular/core';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    buildXtreamEpgMappingKey,
    EpgItem,
} from '@iptvnator/shared/interfaces';
import { XtreamApiService, XtreamCredentials } from './xtream-api.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';

@Injectable({ providedIn: 'root' })
export class XtreamFullEpgService {
    private readonly api = inject(XtreamApiService);
    private readonly xmltv = inject(XtreamXmltvFallbackService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settings = inject(SettingsStore);

    async load(
        { id, ...credentials }: XtreamCredentials & { id?: string },
        streamId: number,
        epgChannelId: string | null
    ): Promise<EpgItem[]> {
        const preferUploaded =
            this.settings.preferUploadedEpgOverXtream?.() ?? false;
        if (this.runtime.supportsEpgMapping && id) {
            try {
                const mapping = await window.electron?.getEpgMapping?.(
                    buildXtreamEpgMappingKey(id, streamId)
                );
                epgChannelId = mapping?.epgChannelId?.trim() || epgChannelId;
            } catch {
                // Keep the provider's EPG identifier if mapping lookup fails.
            }
        }

        return this.xmltv.resolveCurrentEpg({
            epgChannelId,
            preferUploaded,
            fetchProvider: () =>
                this.api.getFullEpg(credentials, streamId, {
                    suppressErrorLog: true,
                }),
        });
    }
}
