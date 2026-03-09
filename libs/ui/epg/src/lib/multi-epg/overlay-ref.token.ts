import { OverlayRef } from '@angular/cdk/overlay';
import { InjectionToken } from '@angular/core';

/**
 * Injection token for providing OverlayRef to dynamically created overlay components
 */
export const COMPONENT_OVERLAY_REF = new InjectionToken<OverlayRef>(
    'COMPONENT_OVERLAY_REF'
);
