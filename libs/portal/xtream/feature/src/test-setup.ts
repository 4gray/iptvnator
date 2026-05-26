import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
import { installDuplicateVideoJsQualityLevelsWarnFilter } from '@iptvnator/shared/testing';

installDuplicateVideoJsQualityLevelsWarnFilter();

setupZoneTestEnv({
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
});
