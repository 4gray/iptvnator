// Keep Zone's fakeAsync helpers while preserving the Angular 21 test scheduler.
import 'zone.js';
import 'zone.js/testing';
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true
});
