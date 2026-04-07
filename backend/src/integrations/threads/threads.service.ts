import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { ImageResizeService } from '../../common/services/image-resize.service';

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);
  private readonly apiBase = 'https://graph.threads.net/v1.0';

  constructor(private readonly imageResizeService: ImageResizeService) { }

  /**
   * Main function to publish a Threads post.
   */
  async publishThreadsPost(
    threadsAccountId: string,
    accessToken: string,
    caption: string,
    mediaUrl: string | null = null,
    location?: { name: string; lat: number; lng: number } | null,
  ): Promise<any> {
    try {
      this.logger.log(`Starting publish process for Threads account: ${threadsAccountId}`);

      let creationId: string;

      if (!mediaUrl) {
        creationId = await this.createTextContainer(threadsAccountId, accessToken, caption, location);
      } else if (this.isVideoUrl(mediaUrl)) {
        creationId = await this.createVideoContainer(threadsAccountId, accessToken, mediaUrl, caption, location);
      } else {
        // Auto-resize image if aspect ratio is outside allowed range
        let resizedUrl = mediaUrl;
        try {
          resizedUrl = await this.imageResizeService.ensureValidAspectRatio(mediaUrl, 'threads');
          if (resizedUrl !== mediaUrl) {
            this.logger.log(`Image resized for Threads compliance. New URL: ${resizedUrl}`);
          }
        } catch (resizeErr) {
          this.logger.warn(`Image resize failed (${resizeErr.message}), using original image`);
        }
        creationId = await this.createImageContainer(threadsAccountId, accessToken, resizedUrl, caption, location);
      }

      // Wait a short moment for the container to process if there's media
      if (mediaUrl) {
        await this.waitForContainerStatus(creationId, accessToken);
      }

      const publishedId = await this.publishContainer(threadsAccountId, accessToken, creationId);

      let permalink = '';
      try {
        const pRes = await axios.get(`${this.apiBase}/${publishedId}`, { params: { fields: 'permalink', access_token: accessToken } });
        permalink = pRes.data.permalink || '';
      } catch (e) {
        this.logger.warn(`Could not fetch permalink for Threads post ${publishedId}`);
      }

      return { id: publishedId, permalink };
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
    location?: { name: string; lat: number; lng: number } | null,
  ): Promise<string> {
    const params: any = {
      media_type: 'TEXT',
      text,
      access_token: accessToken,
    };
    // Threads API location tagging typically requires a location_id from Meta's Pages/Places API.
    // If we have a place id mapped to location.name, we would pass it here.
    if (location && ((location as any).id || (location as any).locationId)) {
      params.location_id = (location as any).id || (location as any).locationId;
    }

    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, { params });
    return response.data.id;
  }

  private async createImageContainer(
    accountId: string,
    accessToken: string,
    imageUrl: string,
    text: string,
    location?: { name: string; lat: number; lng: number } | null,
  ): Promise<string> {
    const params: any = {
      media_type: 'IMAGE',
      image_url: imageUrl,
      text,
      access_token: accessToken,
    };
    if (location && ((location as any).id || (location as any).locationId)) {
      params.location_id = (location as any).id || (location as any).locationId;
    }

    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, { params });
    return response.data.id;
  }

  private async createVideoContainer(
    accountId: string,
    accessToken: string,
    videoUrl: string,
    text: string,
    location?: { name: string; lat: number; lng: number } | null,
  ): Promise<string> {
    const params: any = {
      media_type: 'VIDEO',
      video_url: videoUrl,
      text,
      access_token: accessToken,
    };
    if (location && ((location as any).id || (location as any).locationId)) {
      params.location_id = (location as any).id || (location as any).locationId;
    }

    const response = await axios.post(`${this.apiBase}/${accountId}/threads`, null, { params });
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

  /**
   * Fetch replies for a specific thread (threads_read_replies).
   */
  async getReplies(platformPostId: string, accessToken: string): Promise<any[]> {
    try {
      this.logger.log(`Fetching replies for thread: ${platformPostId}`);
      const response = await axios.get(`${this.apiBase}/${platformPostId}/replies`, {
        params: {
          fields: 'id,text,timestamp,username',
          access_token: accessToken,
          reverse: true,
        },
      });
      const repliesData = response.data.data || [];
      return repliesData.map((r: any) => ({
        id: r.id,
        text: r.text,
        timestamp: r.timestamp,
        username: r.username || 'Unknown User',
        like_count: r.like_count || 0,
        profilePictureUrl: r.user_profile_pic || r.profile_picture_url || null,
      }));
    } catch (error: any) {
      const apiMessage = error?.response?.data?.error?.message || error.message;
      this.logger.error(`Failed to get replies: ${apiMessage}`);
      throw new BadRequestException(apiMessage || 'Failed to fetch replies from Threads');
    }
  }

  /**
   * Reply to an existing thread (threads_manage_replies).
   */
  async replyToThread(
    threadsAccountId: string,
    accessToken: string,
    platformPostId: string,
    text: string
  ): Promise<string> {
    let creationId: string;

    // Step 1: Create the reply container
    try {
      this.logger.log(`Creating reply container for thread: ${platformPostId} (account: ${threadsAccountId})`);
      const createResponse = await axios.post(`${this.apiBase}/${threadsAccountId}/threads`, null, {
        params: {
          media_type: 'TEXT',
          text,
          reply_to_id: platformPostId,
          access_token: accessToken,
        },
      });
      creationId = createResponse.data.id;
      this.logger.log(`Reply container created: ${creationId}`);
    } catch (error: any) {
      const apiMessage = error?.response?.data?.error?.message || error.message;
      const apiCode = error?.response?.data?.error?.code;
      const apiSubcode = error?.response?.data?.error?.error_subcode;
      this.logger.error(`Failed to CREATE reply container: ${apiMessage} (code: ${apiCode}, subcode: ${apiSubcode})`);
      this.logger.error(`Full error response: ${JSON.stringify(error?.response?.data)}`);
      throw new BadRequestException(apiMessage || 'Failed to create reply container');
    }

    // Step 2: Publish the container
    try {
      this.logger.log(`Publishing reply container: ${creationId}`);
      const result = await this.publishContainer(threadsAccountId, accessToken, creationId);
      this.logger.log(`Reply published successfully: ${result}`);
      return result;
    } catch (error: any) {
      const apiMessage = error?.response?.data?.error?.message || error.message;
      const apiCode = error?.response?.data?.error?.code;
      this.logger.error(`Failed to PUBLISH reply container: ${apiMessage} (code: ${apiCode})`);
      this.logger.error(`Full error response: ${JSON.stringify(error?.response?.data)}`);
      throw new BadRequestException(apiMessage || 'Failed to publish reply');
    }
  }

  /**
   * Hide or unhide a reply (threads_manage_replies).
   */
  async hideReply(replyId: string, accessToken: string, hide: boolean = true): Promise<boolean> {
    try {
      this.logger.log(`${hide ? 'Hiding' : 'Unhiding'} reply: ${replyId}`);
      const response = await axios.post(`${this.apiBase}/${replyId}/manage_reply`, null, {
        params: {
          hide: hide ? 'true' : 'false',
          access_token: accessToken,
        },
      });
      return response.data.success;
    } catch (error: any) {
      this.logger.error(`Failed to manage reply: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Profile discovery / search for a user (threads_profile_discovery).
   */
  async getUserProfileDiscovery(accountId: string, accessToken: string, targetUsername: string): Promise<any> {
    try {
      this.logger.log(`Discovering profile for username: ${targetUsername}`);
      // Based on Threads API, Profile Discovery often looks like searching or accessing standard profile fields.
      const response = await axios.get(`${this.apiBase}/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,username,name,threads_profile_picture_url,threads_biography',
        },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Profile discovery failed: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Read mentions (threads_manage_mentions).
   */
  async getMentions(accountId: string, accessToken: string): Promise<any[]> {
    try {
      this.logger.log(`Fetching mentions for account: ${accountId}`);
      const response = await axios.get(`${this.apiBase}/${accountId}/mentions`, {
        params: { access_token: accessToken },
      });
      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch mentions: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Search threads by keyword (threads_keyword_search).
   */
  async searchThreads(accountId: string, accessToken: string, query: string): Promise<any[]> {
    try {
      this.logger.log(`Searching threads for query: ${query}`);
      const response = await axios.get(`${this.apiBase}/threads/search`, {
        params: {
          q: query,
          access_token: accessToken,
        },
      });
      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to search threads: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Delete a thread (threads_delete).
   */
  async deleteThread(platformPostId: string, accessToken: string): Promise<boolean> {
    try {
      this.logger.log(`Deleting thread: ${platformPostId}`);
      // Using DELETE method on the thread ID
      const response = await axios.delete(`${this.apiBase}/${platformPostId}`, {
        params: { access_token: accessToken },
      });
      return response.data.success || true;
    } catch (error: any) {
      this.logger.error(`Failed to delete thread: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  /**
   * Fetch paginated threads history.
   */
  async getAccountPosts(
    accountId: string,
    accessToken: string,
    limit: number = 10,
    afterCursor?: string,
  ): Promise<{ data: any[]; paging: { nextCursor?: string; hasNext: boolean } }> {
    try {
      this.logger.log(`Fetching threads history for Account: ${accountId}`);

      const response = await axios.get(`${this.apiBase}/${accountId}/threads`, {
        params: {
          fields: 'id,media_type,media_url,permalink,text,timestamp',
          limit,
          ...(afterCursor ? { after: afterCursor } : {}),
          access_token: accessToken,
        },
      });

      const data = response.data.data.map((item: any) => ({
        id: item.id,
        text: item.text || '',
        mediaUrl: item.media_url || undefined,
        mediaType: item.media_type, // 'TEXT', 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'
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
        `Failed to fetch Threads history: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch aggregated account analytics by calculating sum of recent post metric insights.
   */
  async getAccountAnalytics(accountId: string, accessToken: string): Promise<any> {
    try {
      this.logger.log(`Fetching aggregated analytics for Threads account: ${accountId}`);
      // Fetch latest 20 posts for aggregation
      const postsResult = await this.getAccountPosts(accountId, accessToken, 20);
      let totalViews = 0, totalLikes = 0, totalReplies = 0, totalShares = 0;

      // Extract insights from each post successfully avoiding rejection of Promise.all
      const promises = postsResult.data.map(p =>
        this.getPostInsights(accountId, accessToken, p.id).catch(() => null)
      );
      const insightsList = await Promise.all(promises);

      insightsList.forEach(ins => {
        if (ins) {
          totalViews += ins.reach || ins.impressions || ins.views || 0;
          totalLikes += ins.likes || 0;
          totalReplies += ins.comments || ins.replies || 0;
          totalShares += ins.shares || ins.reposts || 0;
        }
      });

      return {
        aggregated_views: totalViews,
        total_likes: totalLikes,
        total_replies: totalReplies,
        total_shares: totalShares,
      };
    } catch (err: any) {
      this.logger.error(`Failed to aggregate Threads insights: ${err?.message}`);
      return { aggregated_views: 0, total_likes: 0, total_replies: 0, total_shares: 0 };
    }
  }
}
