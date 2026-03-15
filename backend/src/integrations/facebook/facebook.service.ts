import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly apiBase = 'https://graph.facebook.com/v21.0';

  /**
   * Main function to publish a Facebook post.
   */
  async publishFacebookPost(
    pageId: string,
    pageAccessToken: string,
    caption: string,
    mediaUrl: string | null = null,
  ): Promise<string> {
    try {
      this.logger.log(`Starting publish process for Facebook Page: ${pageId}`);

      if (!mediaUrl) {
        return await this.publishTextPost(pageId, pageAccessToken, caption);
      }

      if (this.isVideoUrl(mediaUrl)) {
        return await this.publishVideo(
          pageId,
          pageAccessToken,
          mediaUrl,
          caption,
        );
      }

      return await this.publishPhoto(
        pageId,
        pageAccessToken,
        mediaUrl,
        caption,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish Facebook post: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  private async publishTextPost(
    pageId: string,
    accessToken: string,
    message: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${pageId}/feed`, null, {
      params: {
        message,
        access_token: accessToken,
      },
    });

    return response.data.id;
  }

  private async publishPhoto(
    pageId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
  ): Promise<string> {
    const response = await axios.post(
      `${this.apiBase}/${pageId}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          caption,
          access_token: accessToken,
        },
      },
    );

    return response.data.id;
  }

  private async publishVideo(
    pageId: string,
    accessToken: string,
    videoUrl: string,
    description: string,
  ): Promise<string> {
    const response = await axios.post(
      `${this.apiBase}/${pageId}/videos`,
      null,
      {
        params: {
          file_url: videoUrl,
          description,
          access_token: accessToken,
        },
      },
    );

    return response.data.id;
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|avi|wmv|webm)(\?.*)?$/i.test(url);
  }
}
