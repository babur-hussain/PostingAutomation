import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const GRAPH_API_VERSION = 'v25.0';

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
    location?: { name: string; lat: number; lng: number }
  ): Promise<string> {
    if (!mediaUrl) {
      throw new Error('Media URL is required for Instagram posting');
    }

    this.logger.log(
      `Starting publish process for Instagram Account: ${igBusinessAccountId}`,
    );
    this.logger.log(`Media URL: ${mediaUrl}`);
    this.logger.log(
      `Token length: ${accessToken?.length}, prefix: ${accessToken?.substring(0, 4)}`,
    );

    const isNativeToken = accessToken?.startsWith('IG');
    const apiBase = isNativeToken
      ? `https://graph.instagram.com/v21.0`
      : `https://graph.facebook.com/${GRAPH_API_VERSION}`;

    this.logger.log(`Using API Base: ${apiBase}`);

    let lastError: any = null;

    try {
      let locationId: string | undefined;
      // Get location ID using graph api search similar to Facebook
      if (location) {
        if ((location as any).id) {
          locationId = (location as any).id;
          this.logger.log(`Using provided native Meta Place ID: ${locationId}`);
        } else if (location.lat && location.lng) {
          try {
            const searchRes = await axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/search`, {
              params: {
                type: 'place',
                center: `${location.lat},${location.lng}`,
                distance: 1000,
                access_token: accessToken,
              }
            });
            if (searchRes.data?.data && searchRes.data.data.length > 0) {
              locationId = searchRes.data.data[0].id;
              this.logger.log(`Mapped location ${location.name} to Instagram Location ID ${locationId}`);
            }
          } catch (err) {
            this.logger.warn(`Failed to resolve Instagram location_id for ${location.name}`);
          }
        }
      }

      // 1. Create container
      const containerId = await this.createContainer(
        apiBase,
        igBusinessAccountId,
        accessToken,
        mediaUrl,
        caption,
        isNativeToken,
        locationId,
      );
      this.logger.log(`Created container: ${containerId}`);

      // Wait for media to be ready (both Image and Video processing take time on Meta's end)
      await this.waitForMediaReady(
        apiBase,
        containerId,
        accessToken,
        {},
        isNativeToken,
      );

      // 2. Publish
      const publishedId = await this.publishContainer(
        apiBase,
        igBusinessAccountId,
        accessToken,
        containerId,
        isNativeToken,
      );
      this.logger.log(`Successfully published Instagram post: ${publishedId}`);
      return publishedId;
    } catch (error) {
      const metaError = error?.response?.data?.error || error?.response?.data;
      this.logger.error(
        `Publishing failed: ${metaError ? JSON.stringify(metaError) : error?.message}`,
      );
      lastError = error;
    }

    throw lastError;
  }

  private async createContainer(
    apiBase: string,
    igAccountId: string,
    accessToken: string,
    mediaUrl: string,
    caption: string,
    isNativeToken: boolean,
    locationId?: string,
  ): Promise<string> {
    const isVideo = this.isVideoUrl(mediaUrl);
    const targetAccountId = isNativeToken ? 'me' : igAccountId;
    const url = `${apiBase}/${targetAccountId}/media`;

    const params = new URLSearchParams();
    params.append('access_token', accessToken);
    if (caption) {
      params.append('caption', caption);
    }
    if (locationId) {
      params.append('location_id', locationId);
    }
    if (isVideo) {
      params.append('media_type', 'REELS');
      params.append('video_url', mediaUrl);
    } else {
      params.append('image_url', mediaUrl);
    }

    this.logger.log(`POST ${url} (URLSearchParams)`);
    const response = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data.id;
  }

  private async publishContainer(
    apiBase: string,
    igAccountId: string,
    accessToken: string,
    creationId: string,
    isNativeToken: boolean,
  ): Promise<string> {
    const targetAccountId = isNativeToken ? 'me' : igAccountId;
    const url = `${apiBase}/${targetAccountId}/media_publish`;
    this.logger.log(`Publishing container ${creationId} at ${url}`);

    const params = new URLSearchParams();
    params.append('creation_id', creationId);
    params.append('access_token', accessToken);

    const response = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data.id;
  }

  private async waitForMediaReady(
    apiBase: string,
    containerId: string,
    accessToken: string,
    headers: Record<string, string>,
    isNativeToken: boolean,
    maxAttempts: number = 30,
    intervalMs: number = 5000,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      // Try with Bearer header first, fallback to query param
      let response: any;
      try {
        if (isNativeToken) {
          response = await axios.get(`${apiBase}/${containerId}`, {
            params: { fields: 'status_code', access_token: accessToken },
            headers,
          });
        } else {
          response = await axios.get(`${apiBase}/${containerId}`, {
            params: { fields: 'status_code' },
            headers,
          });
        }
      } catch {
        response = await axios.get(`${apiBase}/${containerId}`, {
          params: { fields: 'status_code', access_token: accessToken },
        });
      }

      const status = response.data.status_code;
      this.logger.log(
        `Container ${containerId} status: ${status} (attempt ${i + 1}/${maxAttempts})`,
      );

      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new Error(
          `Instagram media processing failed for container ${containerId}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Instagram media processing timed out for container ${containerId}`,
    );
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|mov|avi|wmv|webm)(\?.*)?$/i.test(url);
  }

  /**
   * Fetch insights for an Instagram post (media).
   */
  async getPostInsights(
    igAccountId: string,
    accessToken: string,
    platformPostId: string,
  ): Promise<any> {
    try {
      this.logger.log(`Fetching insights for Instagram post: ${platformPostId}`);

      const isNativeToken = accessToken?.startsWith('IG');
      const apiBase = isNativeToken
        ? `https://graph.instagram.com/v21.0`
        : `https://graph.facebook.com/${GRAPH_API_VERSION}`;

      // 1. Get basic stats (likes, comments)
      const basicResponse = await axios.get(`${apiBase}/${platformPostId}`, {
        params: {
          fields: 'like_count,comments_count,media_type',
          access_token: accessToken,
        },
      });

      const likes = basicResponse.data.like_count || 0;
      const comments = basicResponse.data.comments_count || 0;
      const mediaType = basicResponse.data.media_type;

      // 2. Get Advanced Insights (reach, impressions). 
      // Note: Instagram Basic Display API (native token) might not support all insights. 
      // We will attempt to fetch what we can.
      let reach = 0;
      let impressions = 0;
      let saved = 0;

      try {
        const metrics = mediaType === 'VIDEO' || mediaType === 'REELS'
          ? 'impressions,reach,saved,video_views'
          : 'impressions,reach,saved';

        const insightsResponse = await axios.get(
          `${apiBase}/${platformPostId}/insights`,
          {
            params: {
              metric: metrics,
              access_token: accessToken,
            },
          },
        );

        const data = insightsResponse.data.data || [];
        data.forEach((insight: any) => {
          if (insight.name === 'reach') reach = insight.values[0]?.value || 0;
          if (insight.name === 'impressions') impressions = insight.values[0]?.value || 0;
          if (insight.name === 'saved') saved = insight.values[0]?.value || 0;
        });
      } catch (insightErr) {
        this.logger.warn(`Could not fetch advanced insights for IG post ${platformPostId}: ${insightErr.message}`);
      }

      return {
        likes,
        comments,
        shares: saved, // Map saves to shares for consistency if needed or keep separate
        reach,
        impressions,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Instagram post insights: ${error?.response?.data?.error?.message || error.message}`,
      );
      // Return zeroes if failing
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
   * Delete an Instagram post (media) by its platformPostId.
   * NOTE: Instagram Graph API does NOT support deleting published posts.
   * This method attempts the call but returns false gracefully instead of throwing.
   */
  async deleteMedia(
    igAccountId: string,
    accessToken: string,
    platformPostId: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Attempting to delete Instagram post: ${platformPostId}`);

      const isNativeToken = accessToken?.startsWith('IG');
      const apiBase = isNativeToken
        ? `https://graph.instagram.com/v21.0`
        : `https://graph.facebook.com/${GRAPH_API_VERSION}`;

      await axios.delete(`${apiBase}/${platformPostId}`, {
        params: { access_token: accessToken },
      });
      return true;
    } catch (error) {
      const apiError = error?.response?.data?.error;
      // Instagram does not support deleting published posts via API — gracefully ignore 400/400-class errors
      this.logger.warn(
        `Instagram post deletion not supported by API (expected): ${apiError?.message || error?.message}`,
      );
      // Return false to signal API call was skipped, but don't throw
      return false;
    }
  }

  /**
   * Fetch paginated media history for an Instagram Business Account.
   */
  async getAccountPosts(
    igAccountId: string,
    accessToken: string,
    limit: number = 10,
    afterCursor?: string,
  ): Promise<{ data: any[]; paging: { nextCursor?: string; hasNext: boolean } }> {
    try {
      this.logger.log(`Fetching media history for Instagram Account: ${igAccountId}`);

      const isNativeToken = accessToken?.startsWith('IG');
      const apiBase = isNativeToken
        ? `https://graph.instagram.com/v21.0`
        : `https://graph.facebook.com/${GRAPH_API_VERSION}`;
      const targetAccountId = isNativeToken ? 'me' : igAccountId;

      const response = await axios.get(`${apiBase}/${targetAccountId}/media`, {
        params: {
          fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
          limit,
          ...(afterCursor ? { after: afterCursor } : {}),
          access_token: accessToken,
        },
      });

      this.logger.warn(`RAW INSTAGRAM API RESPONSE: ${JSON.stringify(response.data)}`);

      const data = response.data.data.map((item: any) => ({
        id: item.id,
        text: item.caption || '',
        mediaUrl: item.media_url || undefined,
        thumbnailUrl: item.thumbnail_url || undefined,
        mediaType: item.media_type, // 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'
        permalink: item.permalink,
        timestamp: item.timestamp,
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
        `Failed to fetch Instagram media history: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch comments for an Instagram post (media).
   */
  async getComments(
    igAccountId: string,
    accessToken: string,
    mediaId: string,
  ): Promise<any[]> {
    try {
      this.logger.log(`Fetching comments for Instagram post: ${mediaId}`);
      const isNativeToken = accessToken?.startsWith('IG');
      const apiBase = isNativeToken
        ? `https://graph.instagram.com/v21.0`
        : `https://graph.facebook.com/${GRAPH_API_VERSION}`;

      const response = await axios.get(`${apiBase}/${mediaId}/comments`, {
        params: {
          fields: 'id,text,timestamp,username,like_count,user{profile_picture_url,username},from',
          access_token: accessToken,
        },
      });

      const commentsData = response.data.data || [];
      return commentsData.map((c: any) => ({
        id: c.id,
        text: c.text,
        timestamp: c.timestamp,
        username: c.username || c.from?.username || c.user?.username || 'Unknown User',
        like_count: c.like_count || 0,
        profilePictureUrl: c.user?.profile_picture_url || null,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch Instagram comments: ${error?.response?.data?.error?.message || error.message}`);
      return [];
    }
  }

  /**
   * Reply to an Instagram comment or post.
   */
  async replyToComment(
    igAccountId: string,
    accessToken: string,
    targetId: string,
    message: string,
  ): Promise<string> {
    try {
      this.logger.log(`Replying to Instagram target: ${targetId}`);
      const isNativeToken = accessToken?.startsWith('IG');
      const apiBase = isNativeToken
        ? `https://graph.instagram.com/v21.0`
        : `https://graph.facebook.com/${GRAPH_API_VERSION}`;

      const response = await axios.post(`${apiBase}/${targetId}/replies`, null, {
        params: {
          message,
          access_token: accessToken,
        },
      });

      return response.data.id;
    } catch (error: any) {
      this.logger.error(`Failed to reply to Instagram comment/post: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }
}
