// Local lazy boundary: refresh recovery must not load during ordinary startup.
export {
    XtreamDeferredCatalogRestoreService,
    beginCatalogHistoryRecovery,
    captureCatalogCacheRecoveryState,
    clearCatalogHistoryRecovery,
    prepareLegacyCatalogHistoryRecovery,
    readCatalogRecoveryVisibility,
} from '@iptvnator/services/xtream-catalog-restore';
