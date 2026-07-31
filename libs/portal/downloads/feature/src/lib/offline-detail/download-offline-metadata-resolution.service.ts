import {
    effect,
    inject,
    Injectable,
    Injector,
    signal,
    type Signal,
} from '@angular/core';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';
import { DownloadOfflineMetadataService } from './download-offline-metadata.service';

export interface OfflineMetadataResolution {
    readonly generation: number;
    readonly identity?: string;
    readonly snapshot?: DownloadMetadataSnapshot;
}

@Injectable()
export class DownloadOfflineMetadataResolutionService {
    private readonly metadata = inject(DownloadOfflineMetadataService);
    private readonly injector = inject(Injector);
    private readonly state = signal<OfflineMetadataResolution>({
        generation: 0,
    });
    private generation = 0;

    readonly resolution = this.state.asReadonly();

    connect(
        detail: Signal<DownloadOfflineDetail | undefined>,
        identity: Signal<string | undefined>
    ): void {
        effect(
            () => {
                const currentDetail = detail();
                const currentIdentity = identity();
                const generation = ++this.generation;
                this.state.set({ generation, identity: currentIdentity });
                if (!currentDetail || !currentIdentity) return;
                void this.metadata
                    .resolve(currentDetail)
                    .then((snapshot) => {
                        if (
                            generation === this.generation &&
                            currentIdentity === identity()
                        ) {
                            this.state.set({
                                generation,
                                identity: currentIdentity,
                                snapshot,
                            });
                        }
                    })
                    .catch(() => undefined);
            },
            { injector: this.injector }
        );
    }
}
