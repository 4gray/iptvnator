import { Injectable, Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'filterBy',
    standalone: true,
})
@Injectable()
export class FilterPipe implements PipeTransform {
    transform(array: any[], filter: string, property: string): any {
        if (!array || !filter) {
            return array;
        }
        return array.filter((item) =>
            item[property].toLowerCase().includes(filter.toLowerCase())
        );
    }
}
