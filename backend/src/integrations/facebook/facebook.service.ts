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

  /**
   * Fetch post insights (engagement, reach) for a Facebook page post.
   */
  async getPostInsights(
    pageId: string,
    accessToken: string,
    platformPostId: string,
  ): Promise<any> {
    try {
      this.logger.log(`Fetching insights for Facebook post: ${platformPostId}`);
      // Fetch post reactions, comments, shares, and insights
      const response = await axios.get(
        `${this.apiBase}/${platformPostId}`,
        {
          params: {
            fields: 'shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions,post_impressions_unique)',
            access_token: accessToken,
          },
        },
      );

      const data = response.data;
      const shares = data.shares?.count || 0;
      const likes = data.likes?.summary?.total_count || 0;
      const comments = data.comments?.summary?.total_count || 0;
      
      let reach = 0;
      let impressions = 0;

      if (data.insights && data.insights.data) {
        data.insights.data.forEach((insight: any) => {
          if (insight.name === 'post_impressions_unique') {
            reach = insight.values[0]?.value || 0;
          }
          if (insight.name === 'post_impressions') {
            impressions = insight.values[0]?.value || 0;
          }
        });
      }

      return {
        likes,
        comments,
        shares,
        reach,
        impressions,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Facebook post insights: ${error?.response?.data?.error?.message || error.message}`,
      );
      // Return zeroes if insights can't be fetched (e.g. post deleted, token expired)
      return {
        likes: 0,
        comments: 0,
        shares: 0,
        reach: 0,
        impressions: 0,
      };
    }
  }

  /**
   * Delete a Facebook post by its platformPostId.
   */
  async deletePost(
    pageId: string,
    accessToken: string,
    platformPostId: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Deleting Facebook post: ${platformPostId}`);
      await axios.delete(`${this.apiBase}/${platformPostId}`, {
        params: { access_token: accessToken },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to delete Facebook post: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }
}
