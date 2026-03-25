import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { withRetry } from '../../common/utils/retry.util';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly apiBase = 'https://graph.facebook.com/v22.0';

  /**
   * Main function to publish a Facebook post.
   */
  async publishFacebookPost(
    pageId: string,
    pageAccessToken: string,
    caption: string,
    mediaUrl: string | null = null,
    location?: { name: string; lat: number; lng: number }
  ): Promise<string> {
    return withRetry(async () => {
      try {
        this.logger.log(`Starting publish process for Facebook Page: ${pageId}`);

        let placeId: string | undefined;
        if (location) {
          if ((location as any).id) {
            placeId = (location as any).id;
            this.logger.log(`Using provided native Meta Place ID: ${placeId}`);
          } else if (location.lat && location.lng) {
            try {
              const searchRes = await axios.get(`${this.apiBase}/search`, {
                params: {
                  type: 'place',
                  center: `${location.lat},${location.lng}`,
                  distance: 1000,
                  access_token: pageAccessToken,
                }
              });
              if (searchRes.data?.data && searchRes.data.data.length > 0) {
                placeId = searchRes.data.data[0].id;
                this.logger.log(`Mapped unified location ${location.name} to Facebook Place ID ${placeId}`);
              }
            } catch (err) {
              this.logger.warn(`Failed to resolve Facebook place ID for location ${location.name}`);
            }
          }
        }

        if (!mediaUrl) {
          return await this.publishTextPost(pageId, pageAccessToken, caption, placeId);
        }

        if (this.isVideoUrl(mediaUrl)) {
          return await this.publishVideo(
            pageId,
            pageAccessToken,
            mediaUrl,
            caption,
            placeId,
          );
        }

        return await this.publishPhoto(
          pageId,
          pageAccessToken,
          mediaUrl,
          caption,
          placeId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to publish Facebook post: ${error?.response?.data?.error?.message || error.message}`,
        );
        throw error;
      }
    });
  }

  private async publishTextPost(
    pageId: string,
    accessToken: string,
    message: string,
    placeId?: string,
  ): Promise<string> {
    const response = await axios.post(`${this.apiBase}/${pageId}/feed`, null, {
      params: {
        message,
        access_token: accessToken,
        ...(placeId && { place: placeId }),
      },
    });

    return response.data.id;
  }

  private async publishPhoto(
    pageId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
    placeId?: string,
  ): Promise<string> {
    const response = await axios.post(
      `${this.apiBase}/${pageId}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          caption,
          access_token: accessToken,
          ...(placeId && { place: placeId }),
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
    placeId?: string,
  ): Promise<string> {
    const response = await axios.post(
      `${this.apiBase}/${pageId}/videos`,
      null,
      {
        params: {
          file_url: videoUrl,
          description,
          access_token: accessToken,
          ...(placeId && { place: placeId }),
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
    return withRetry(async () => {
      try {
        this.logger.log(`Fetching basic engagement for Facebook post: ${platformPostId}`);
        const basicResponse = await axios.get(
          `${this.apiBase}/${platformPostId}`,
          {
            params: {
              fields: 'shares,likes.summary(true),comments.summary(true)',
              access_token: accessToken,
            },
          },
        );

        const data = basicResponse.data;
        const shares = data.shares?.count || 0;
        const likes = data.likes?.summary?.total_count || 0;
        const comments = data.comments?.summary?.total_count || 0;

        let reach = 0;
        let impressions = 0;

        try {
          this.logger.log(`Fetching advanced insights for Facebook post: ${platformPostId}`);
          const insightsResponse = await axios.get(
            `${this.apiBase}/${platformPostId}/insights`,
            {
              params: {
                metric: 'post_impressions,post_impressions_unique',
                access_token: accessToken,
              },
            },
          );

          const insightsData = insightsResponse.data.data;
          if (insightsData) {
            insightsData.forEach((insight: any) => {
              if (insight.name === 'post_impressions_unique') {
                reach = insight.values[0]?.value || 0;
              }
              if (insight.name === 'post_impressions') {
                impressions = insight.values[0]?.value || 0;
              }
            });
          }
        } catch (insightsError: any) {
          this.logger.warn(`Advanced insights unavailable for Facebook post: ${platformPostId}. ${insightsError?.response?.data?.error?.message || insightsError.message}`);
        }

        return {
          likes,
          comments,
          shares,
          reach,
          impressions,
        };
      } catch (error: any) {
        this.logger.error(
          `Failed to fetch Facebook post insights: ${error?.response?.data?.error?.message || error.message}`,
        );
        return {
          likes: 0,
          comments: 0,
          shares: 0,
          reach: 0,
          impressions: 0,
        };
      }
    });
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

  /**
   * Fetch paginated post history for a Facebook page.
   */
  async getAccountPosts(
    pageId: string,
    accessToken: string,
    limit: number = 10,
    afterCursor?: string,
  ): Promise<{ data: any[]; paging: { nextCursor?: string; hasNext: boolean } }> {
    try {
      this.logger.log(`Fetching posts history for Facebook Page: ${pageId}`);
      
      const response = await axios.get(`${this.apiBase}/${pageId}/published_posts`, {
        params: {
          fields: 'id,message,created_time,full_picture,permalink_url',
          limit,
          ...(afterCursor ? { after: afterCursor } : {}),
          access_token: accessToken,
        },
      });

      const data = response.data.data.map((post: any) => ({
        id: post.id,
        text: post.message || '',
        mediaUrl: post.full_picture || undefined,
        mediaType: post.full_picture ? 'IMAGE' : 'TEXT',
        permalink: post.permalink_url,
        timestamp: post.created_time,
      }));

      const paging = response.data.paging || {};
      const nextCursor = paging.cursors?.after || undefined;

      return {
        data,
        paging: {
          nextCursor,
          hasNext: !!paging.next,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch Facebook posts history: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch comments for a Facebook post (media).
   */
  async getComments(
    pageId: string,
    accessToken: string,
    postId: string,
  ): Promise<any[]> {
    try {
      this.logger.log(`Fetching comments for Facebook post: ${postId}`);

      const response = await axios.get(`${this.apiBase}/${postId}/comments`, {
        params: {
          fields: 'id,message,created_time,from{id,name,picture},like_count',
          access_token: accessToken,
        },
      });

      const data = response.data.data || [];
      return data.map((c: any) => ({
        id: c.id,
        text: c.message,
        timestamp: c.created_time,
        username: c.from?.name || 'Unknown User',
        like_count: c.like_count || 0,
        profilePictureUrl: c.from?.picture?.data?.url || null,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch Facebook comments: ${error?.response?.data?.error?.message || error.message}`);
      return [];
    }
  }

  /**
   * Reply to a Facebook comment or post.
   */
  async replyToComment(
    pageId: string,
    accessToken: string,
    targetId: string,
    message: string,
  ): Promise<string> {
    try {
      this.logger.log(`Replying to Facebook target: ${targetId}`);

      const response = await axios.post(`${this.apiBase}/${targetId}/comments`, null, {
        params: {
          message,
          access_token: accessToken,
        },
      });

      return response.data.id;
    } catch (error: any) {
      this.logger.error(`Failed to reply to Facebook target: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }
}
