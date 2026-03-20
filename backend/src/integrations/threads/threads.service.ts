import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);
  private readonly apiBase = 'https://graph.threads.net/v1.0';

  /**
   * Main function to publish a Threads post.
   */
  async publishThreadsPost(
    threadsAccountId: string,
    accessToken: string,
    caption: string,
    mediaUrl: string | null = null,
    location?: { name: string; lat: number; lng: number } | null,
  ): Promise<string> {
    try {
      this.logger.log(`Starting publish process for Threads account: ${threadsAccountId}`);

      let creationId: string;

      if (!mediaUrl) {
        creationId = await this.createTextContainer(threadsAccountId, accessToken, caption);
      } else if (this.isVideoUrl(mediaUrl)) {
        creationId = await this.createVideoContainer(threadsAccountId, accessToken, mediaUrl, caption);
      } else {
        creationId = await this.createImageContainer(threadsAccountId, accessToken, mediaUrl, caption);
      }

      // Wait a short moment for the container to process if there's media
      if (mediaUrl) {
        await this.waitForContainerStatus(creationId, accessToken);
      }

      return await this.publishContainer(threadsAccountId, accessToken, creationId);
    } catch (error: any) {
      this.logger.error(
        `Failed to publish Threads post: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  private async createTextContainer(
    accountId: string,
    accessToken: string,
    text: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, {
      params: {
        media_type: 'TEXT',
        text,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  private async createImageContainer(
    accountId: string,
    accessToken: string,
    imageUrl: string,
    text: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, {
      params: {
        media_type: 'IMAGE',
        image_url: imageUrl,
        text,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  private async createVideoContainer(
    accountId: string,
    accessToken: string,
    videoUrl: string,
    text: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, {
      params: {
        media_type: 'VIDEO',
        video_url: videoUrl,
        text,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  private async publishContainer(
    accountId: string,
    accessToken: string,
    creationId: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${accountId}/threads_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  private async waitForContainerStatus(
    creationId: string,
    accessToken: string,
    maxRetries = 10,
  ): Promise<void> {
    // Media containers, especially videos, need time to process on Meta's end
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await axios.get(`${this.apiBase}/${creationId}`, {
          params: {
            fields: 'status,error_message',
            access_token: accessToken,
          },
        });

        const status = response.data.status;
        if (status === 'FINISHED') return;
        if (status === 'ERROR') throw new Error(`Container processing failed: ${response.data.error_message}`);

        await delay(3000); // Poll every 3 seconds
      } catch (err: any) {
        if (err.message.includes('Container processing failed')) throw err;
        this.logger.warn(`Failed to check container status, retrying: ${err?.response?.data?.error?.message || err.message}`);
        await delay(3000);
      }
    }
    this.logger.warn(`Container ${creationId} did not finish processing in time, attempting publish anyway...`);
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|avi|wmv|webm)(\?.*)?$/i.test(url);
  }

  /**
   * Fetch insights for a Threads post (media).
   */
  async getPostInsights(
    accountId: string,
    accessToken: string,
    platformPostId: string,
  ): Promise<any> {
    try {
      this.logger.log(`Fetching insights for Threads post: ${platformPostId}`);

      const metrics = 'views,likes,replies,reposts,quotes';
      const response = await axios.get(`${this.apiBase}/${platformPostId}/insights`, {
        params: {
          metric: metrics,
          access_token: accessToken,
        },
      });

      const data = response.data.data || [];
      let views = 0, likes = 0, replies = 0, reposts = 0, quotes = 0;

      data.forEach((insight: any) => {
        if (insight.name === 'views') views = insight.values[0]?.value || 0;
        if (insight.name === 'likes') likes = insight.values[0]?.value || 0;
        if (insight.name === 'replies') replies = insight.values[0]?.value || 0;
        if (insight.name === 'reposts') reposts = insight.values[0]?.value || 0;
        if (insight.name === 'quotes') quotes = insight.values[0]?.value || 0;
      });

      return {
        likes,
        comments: replies,
        shares: reposts + quotes,
        reach: views,
        impressions: views,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch Threads post insights: ${error?.response?.data?.error?.message || error.message}`,
      );
      return {
        likes: 0,
        comments: 0,
        shares: 0,
        reach: 0,
        impressions: 0,
      };
    }
  }
}
