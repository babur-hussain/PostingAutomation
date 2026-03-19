import { Injectable, Logger } from '@nestjs/common';
import { TwitterApi } from 'twitter-api-v2';
import axios from 'axios';

@Injectable()
export class XService {
  private readonly logger = new Logger(XService.name);

  /**
   * Initialize a Twitter API client with the given credentials.
   * OAuth 1.0a requires all 4 tokens (consumer, access, and both secrets).
   */
  private getClient(
    appKey: string,
    appSecret: string,
    accessToken: string,
    accessSecret: string,
  ): TwitterApi {
    return new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });
  }

  /**
   * Publish a tweet to X (Twitter).
   * 
   * If mediaUrl is provided:
   * 1. Downloads the media from the URL.
   * 2. Uploads the media to Twitter using the v1.1 endpoint (v2 doesn't support media upload).
   * 3. Attaches the media ID to the tweet using the v2 endpoint.
   */
  async publishTweet(
    appKey: string,
    appSecret: string,
    accessToken: string,
    accessSecret: string,
    text: string,
    mediaUrl?: string | null,
    location?: { name: string; lat: number; lng: number }
  ): Promise<string> {
    if (!text && !mediaUrl) {
      throw new Error('A tweet requires either text or media.');
    }

    const client = this.getClient(appKey, appSecret, accessToken, accessSecret);
    let mediaId: string | undefined = undefined;

    try {
      if (mediaUrl) {
        this.logger.log(`Downloading media for X upload from: ${mediaUrl}`);

        // 1. Download media
        const response = await axios.get(mediaUrl, {
          responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(response.data, 'binary');
        const mimeType = response.headers['content-type'];

        this.logger.log(`Downloaded media (${buffer.length} bytes, type: ${mimeType}). Uploading to X...`);

        // 2. Upload media via Twitter v1.1
        mediaId = await client.v1.uploadMedia(buffer, { mimeType });
        this.logger.log(`Successfully uploaded media to X with ID: ${mediaId}`);
      }

      // 3. Publish the Tweet (v2)
      this.logger.log(`Publishing Tweet...`);
      const tweetOptions: any = { text: text || '' };

      if (mediaId) {
        tweetOptions.media = { media_ids: [mediaId] };
      }

      if (location) {
        try {
          const geoRes = await client.v1.get('geo/search.json', {
            lat: location.lat,
            long: location.lng,
            granularity: 'city',
            max_results: 1
          });

          if (geoRes?.result?.places && geoRes.result.places.length > 0) {
            tweetOptions.geo = { place_id: geoRes.result.places[0].id };
            this.logger.log(`Mapped location ${location.name} to Twitter Place ID ${tweetOptions.geo.place_id}`);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to resolve Twitter place ID for location ${location.name}: ${err.message}`);
        }
      }

      const createdTweet = await client.v2.tweet(tweetOptions);
      const tweetId = createdTweet.data.id;

      this.logger.log(`Successfully published Tweet with ID: ${tweetId}`);
      return tweetId;

    } catch (error: any) {
      this.logger.error(`Failed to publish tweet: ${error.message}`, error.stack);

      // Attempt to extract deeper Twitter API v2 errors if present
      if (error.data && error.data.detail) {
        throw new Error(`X API Error: ${error.data.detail}`);
      }
      if (error.response && error.response.data) {
        throw new Error(`X API Error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
}
