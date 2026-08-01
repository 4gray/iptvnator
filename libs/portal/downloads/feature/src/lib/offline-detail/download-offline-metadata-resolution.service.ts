import {
    effect,
    inject,
    Injectable,
    Injector,
    signal,
    type Signal,
    untracked,
} from '@angular/core';
import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';
import { DownloadOfflineMetadataService } from './download-offline-metadata.service';

export interface OfflineMetadataResolution {
    readonly generation: number;
    readonly key?: string;
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
    private readonly inFlight = new Map<
        string,
        Promise<DownloadMetadataSnapshot>
    >();

    readonly resolution = this.state.asReadonly();

    connect(
        key: Signal<string | undefined>,
        currentDetail: () => DownloadOfflineDetail | undefined
    ): void {
        effect(
            () => {
                const currentKey = key();
                const generation = ++this.generation;
                this.state.set({ generation, key: currentKey });
                const detail = untracked(currentDetail);
                if (!detail || !currentKey) return;
                void this.resolveOnce(currentKey, detail)
                    .then((snapshot) => {
                        this.clearRequest(currentKey);
                        if (
                            generation === this.generation &&
                            currentKey === key()
                        ) {
                            this.state.set({
                                generation,
                                key: currentKey,
                                snapshot,
                            });
                        }
                    })
                    .catch(() => this.clearRequest(currentKey));
            },
            { injector: this.injector }
        );
    }

    private resolveOnce(
        key: string,
        detail: DownloadOfflineDetail
    ): Promise<DownloadMetadataSnapshot> {
        const active = this.inFlight.get(key);
        if (active) return active;
        const request = this.metadata.resolve(detail);
        this.inFlight.set(key, request);
        return request;
    }

    private clearRequest(key: string): void {
        this.inFlight.delete(key);
    }
}
