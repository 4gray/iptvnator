import type { VideoPlayer } from '@iptvnator/shared/interfaces';
import type {
    MultiviewEndReason,
    MultiviewLayout,
    MultiviewPipGeometry,
    MultiviewTile,
    MultiviewTileSource,
    MultiviewTileStatus,
} from './multiview-session.model';

/**
 * Everything that changes a session. Tile ids come from the caller so the
 * reducer stays pure; the store generates them.
 */
export type MultiviewCommand =
    | {
          readonly type: 'start';
          readonly anchorId: string;
          readonly primary: MultiviewTileSource;
          readonly primaryTileId: string;
          readonly primaryEngine: VideoPlayer;
          readonly added: MultiviewTileSource;
          readonly addedTileId: string;
      }
    | {
          readonly type: 'add';
          readonly source: MultiviewTileSource;
          readonly tileId: string;
      }
    | {
          readonly type: 'replace';
          readonly tileId: string;
          readonly source: MultiviewTileSource;
      }
    | { readonly type: 'undo-replace'; readonly previous: MultiviewTile }
    | { readonly type: 'remove'; readonly tileId: string }
    | { readonly type: 'swap' }
    | { readonly type: 'set-audio'; readonly tileId: string }
    | { readonly type: 'set-active'; readonly tileId: string }
    | { readonly type: 'set-layout'; readonly layout: MultiviewLayout }
    | {
          readonly type: 'set-pip-geometry';
          readonly geometry: MultiviewPipGeometry;
      }
    | {
          readonly type: 'tile-status';
          readonly tileId: string;
          readonly status: MultiviewTileStatus;
      }
    | {
          readonly type: 'tile-position';
          readonly tileId: string;
          readonly seconds: number;
      }
    | { readonly type: 'withhold'; readonly tileIds: readonly string[] }
    | { readonly type: 'exit' }
    | {
          readonly type: 'end';
          readonly reason: Extract<
              MultiviewEndReason,
              'anchor-left' | 'player-unsupported' | 'stage-unavailable'
          >;
      };
