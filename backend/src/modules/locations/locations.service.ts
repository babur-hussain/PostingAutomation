import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class LocationsService {
    private readonly logger = new Logger(LocationsService.name);

    async searchPlaces(query: string) {
        try {
            if (!query || query.trim() === '') return [];

            const response = await axios.get('https://nominatim.openstreetmap.org/search', {
                params: {
                    q: query,
                    format: 'json',
                    limit: 10,
                },
                headers: {
                    'User-Agent': 'PostingAutomationApp/1.0',
                }
            });

            return response.data.map((place: any) => ({
                name: place.display_name,
                lat: parseFloat(place.lat),
                lng: parseFloat(place.lon),
            }));
        } catch (error: any) {
            this.logger.error(`Failed to geocode location query '${query}': ${error.message}`);
            return [];
        }
    }
}
