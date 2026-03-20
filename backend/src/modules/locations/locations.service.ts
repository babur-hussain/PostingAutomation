import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class LocationsService {
    private readonly logger = new Logger(LocationsService.name);

    async searchPlaces(query: string) {
        try {
            if (!query || query.trim() === '') return [];

            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            if (!apiKey) {
                this.logger.error('GOOGLE_MAPS_API_KEY is not defined in the environment variables.');
                return [];
            }

            const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
                params: {
                    query: query,
                    key: apiKey,
                },
            });

            if (!response.data || !response.data.results) {
                return [];
            }

            return response.data.results.map((place: any) => ({
                name: `${place.name}${place.formatted_address ? `, ${place.formatted_address}` : ''}`,
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng,
            }));
        } catch (error: any) {
            this.logger.error(`Failed to geocode location query '${query}' via Google Maps: ${error.message}`);
            return [];
        }
    }
}
