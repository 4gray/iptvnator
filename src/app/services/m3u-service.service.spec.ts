/* tslint:disable:no-unused-variable */

import { TestBed, async, inject } from '@angular/core/testing';
import { M3uServiceService } from './m3u-service.service';

describe('Service: M3uService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [M3uServiceService]
    });
  });

  it('should ...', inject([M3uServiceService], (service: M3uServiceService) => {
    expect(service).toBeTruthy();
  }));
});
