import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const GRAPH_API_VERSION = 'v22.0';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /**
   * Instagram Content Publishing API for Instagram Business Login.
   *
   * Uses graph.instagram.com with Bearer token authentication
   * and JSON request body as per Meta's official documentation:
   * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
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

    const apiBase = `https://graph.instagram.com/${GRAPH_API_VERSION}`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    // 1. Create media container
    const containerId = await this.createContainer(
      apiBase, igBusinessAccountId, headers, mediaUrl, caption,
    );
    this.logger.log(`Created container: ${containerId}`);

    // Wait for media to be ready if it's a video
    if (this.isVideoUrl(mediaUrl)) {
      await this.waitForMediaReady(apiBase, containerId, headers);
    }

    // 2. Publish the container
    const publishedId = await this.publishContainer(
      apiBase, igBusinessAccountId, headers, containerId,
    );

    this.logger.log(`Successfully published Instagram post: ${publishedId}`);
    return publishedId;
  }

  private async createContainer(
    apiBase: string,
    igAccountId: string,
    headers: Record<string, string>,
    mediaUrl: string,
    caption: string,
  ): Promise<string> {
    const isVideo = this.isVideoUrl(mediaUrl);

    const body: any = { caption };
    if (isVideo) {
      body.media_type = 'VIDEO';
      body.video_url = mediaUrl;
    } else {
      body.image_url = mediaUrl;
    }

    this.logger.log(`Creating container at ${apiBase}/${igAccountId}/media with body: ${JSON.stringify(body)}`);

    const response = await axios.post(
      `${apiBase}/${igAccountId}/media`,
      body,
      { headers },
    );

    return response.data.id;
  }

  private async publishContainer(
    apiBase: string,
    igAccountId: string,
    headers: Record<string, string>,
    creationId: string,
  ): Promise<string> {
    this.logger.log(`Publishing container ${creationId} at ${apiBase}/${igAccountId}/media_publish`);

    const response = await axios.post(
      `${apiBase}/${igAccountId}/media_publish`,
      { creation_id: creationId },
      { headers },
    );

    return response.data.id;
  }

  private async waitForMediaReady(
    apiBase: string,
    containerId: string,
    headers: Record<string, string>,
    maxAttempts: number = 30,
    intervalMs: number = 5000,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `${apiBase}/${containerId}`,
        {
          params: { fields: 'status_code' },
          headers,
        },
      );

      const status = response.data.status_code;
      this.logger.log(`Container ${containerId} status: ${status} (attempt ${i + 1}/${maxAttempts})`);

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
