import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /**
   * Instagram Content Publishing API for Instagram Business Login.
   *
   * Uses graph.instagram.com as the host URL since we have an IGAA-prefixed
   * token from Instagram Business Login (not a Facebook EAAC token).
   *
   * The API tries multiple host/version combinations to find what works:
   * 1. graph.instagram.com/v22.0 (latest)
   * 2. graph.instagram.com/v21.0
   * 3. graph.facebook.com/v21.0 (Facebook Graph API)
   */

  async publishInstagramPost(
    igBusinessAccountId: string,
    accessToken: string,
    mediaUrl: string,
    caption: string,
  ): Promise<string> {
    if (!mediaUrl) {
      throw new Error('Media URL is required for Instagram posting');
    }

    this.logger.log(`Starting publish process for Instagram Account: ${igBusinessAccountId}`);
    this.logger.log(`Media URL: ${mediaUrl}`);
    this.logger.log(`Token length: ${accessToken?.length}, prefix: ${accessToken?.substring(0, 4)}`);

    // Try multiple API base URLs since different token types work with different hosts
    const apiBases = [
      'https://graph.instagram.com/v22.0',
      'https://graph.instagram.com/v21.0',
      'https://graph.facebook.com/v21.0',
    ];

    let lastError: any = null;

    for (const apiBase of apiBases) {
      try {
        this.logger.log(`Trying API base: ${apiBase}`);

        // 1. Create container
        const containerId = await this.createContainer(apiBase, igBusinessAccountId, accessToken, mediaUrl, caption);
        this.logger.log(`Created container: ${containerId} (using ${apiBase})`);

        // Wait for media to be ready if it's a video
        if (this.isVideoUrl(mediaUrl)) {
          await this.waitForMediaReady(apiBase, containerId, accessToken);
        }

        // 2. Publish container
        const publishedId = await this.publishContainer(apiBase, igBusinessAccountId, accessToken, containerId);

        this.logger.log(`Successfully published Instagram post: ${publishedId}`);
        return publishedId;
      } catch (error) {
        const metaError = error?.response?.data?.error;
        this.logger.warn(`Failed with ${apiBase}: ${metaError ? JSON.stringify(metaError) : error.message}`);
        lastError = error;
      }
    }

    // All attempts failed
    const metaError = lastError?.response?.data?.error;
    this.logger.error(`All publish attempts failed. Last error: ${metaError ? JSON.stringify(metaError) : lastError?.message}`);
    throw lastError;
  }

  private async createContainer(
    apiBase: string,
    igAccountId: string,
    accessToken: string,
    mediaUrl: string,
    caption: string,
  ): Promise<string> {
    const isVideo = this.isVideoUrl(mediaUrl);

    const params: any = {
      access_token: accessToken,
      caption,
    };

    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = mediaUrl;
    } else {
      params.image_url = mediaUrl;
    }

    const response = await axios.post(
      `${apiBase}/${igAccountId}/media`,
      null,
      { params },
    );

    return response.data.id;
  }

  private async publishContainer(
    apiBase: string,
    igAccountId: string,
    accessToken: string,
    creationId: string,
  ): Promise<string> {
    const response = await axios.post(
      `${apiBase}/${igAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId,
          access_token: accessToken,
        },
      },
    );

    return response.data.id;
  }

  private async waitForMediaReady(
    apiBase: string,
    containerId: string,
    accessToken: string,
    maxAttempts: number = 30,
    intervalMs: number = 5000,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `${apiBase}/${containerId}`,
        {
          params: {
            fields: 'status_code',
            access_token: accessToken,
          },
        },
      );

      const status = response.data.status_code;
      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new Error(`Instagram media processing failed for container ${containerId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Instagram media processing timed out for container ${containerId}`);
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|avi|wmv|webm)(\?.*)?$/i.test(url);
  }
}
