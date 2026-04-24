import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Instagram Business Login provider.
 * Uses Instagram's own OAuth flow per Meta's official docs:
 * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
 *
 * Flow:
 * 1. Auth URL: https://www.instagram.com/oauth/authorize
 * 2. Token exchange: POST https://api.instagram.com/oauth/access_token
 * 3. Long-lived token: GET https://graph.instagram.com/access_token
 */
@Injectable()
export class InstagramProvider {
  private readonly logger = new Logger(InstagramProvider.name);

  /**
   * Scopes for Instagram Business Login:
   * - instagram_business_basic: Read profile info and media
   * - instagram_business_content_publish: Publish media to Instagram
   * - instagram_business_manage_messages: (future) DM management
   * - instagram_manage_comments: Manage comments on posts
   * - instagram_manage_insights: Read analytics/insights
   * - instagram_manage_contents: Delete posts from Instagram
   */
  static readonly SCOPES = [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_insights',
    'instagram_business_manage_messages',
  ];

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('meta.instagramAppId') || '';
    this.appSecret =
      this.configService.get<string>('meta.instagramAppSecret') || '';
    this.redirectUri = this.configService.get<string>('meta.redirectUri') || '';
  }

  /**
   * Generate Instagram OAuth authorization URL.
   * Opens Instagram's own login page (instagram.com).
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: InstagramProvider.SCOPES.join(','),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for short-lived access token.
   * POST https://api.instagram.com/oauth/access_token
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const axios = (await import('axios')).default;

    // Instagram appends #_ to the authorization code — strip it
    const cleanCode = code.replace(/#_$/, '');

    // Instagram expects form-data, not query params
    const formData = new URLSearchParams();
    formData.append('client_id', this.appId);
    formData.append('client_secret', this.appSecret);
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', this.redirectUri);
    formData.append('code', cleanCode);

    this.logger.log(
      `Exchanging code for token with redirect_uri: ${this.redirectUri}`,
    );

    const response = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      formData.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    this.logger.log(
      `Token exchange raw response: ${JSON.stringify(response.data)}`,
    );

    // Response: { data: [{ access_token, user_id, permissions }] }
    const tokenData = response.data.data?.[0] || response.data;

    this.logger.log(
      `Parsed token data - user_id: ${tokenData.user_id}, has_token: ${!!tokenData.access_token}`,
    );

    return {
      accessToken: tokenData.access_token,
      userId: tokenData.user_id?.toString(),
    };
  }

  /**
   * Exchange short-lived token for long-lived token (~60 days).
   * Per official Meta docs:
   * GET https://graph.instagram.com/access_token
   *   ?grant_type=ig_exchange_token
   *   &client_secret=<INSTAGRAM_APP_SECRET>
   *   &access_token=<SHORT_LIVED_TOKEN>
   */
  async getLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;

    this.logger.log(`Exchanging short-lived token for long-lived token...`);

    const response = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: this.appSecret,
          access_token: shortLivedToken,
        },
      },
    );

    this.logger.log(
      `Long-lived token exchange response: ${JSON.stringify(response.data)}`,
    );

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in || 5184000,
    };
  }

  /**
   * Get Instagram user profile info.
   * GET https://graph.instagram.com/v21.0/{user_id}
   */
  async getUserProfile(accessToken: string): Promise<{
    userId: string;
    username: string;
    name: string;
    profilePictureUrl?: string;
    accountType?: string;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get(`https://graph.instagram.com/v21.0/me`, {
      params: {
        fields: 'user_id,username,name,profile_picture_url,account_type',
        access_token: accessToken,
      },
    });

    return {
      userId: response.data.user_id?.toString() || response.data.id,
      username: response.data.username,
      name: response.data.name || response.data.username,
      profilePictureUrl: response.data.profile_picture_url,
      accountType: response.data.account_type,
    };
  }

  /**
   * Get comprehensive insights for an Instagram user profile.
   * Fetches metrics in safe batches to avoid a single deprecated metric killing the request.
   * Reference: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights
   *
   * Instagram Insights API uses:
   *   - metric_type=total_value (returns { total_value: { value: N } })
   *   - period=day
   *   - since/until for time range
   */
  async getUserInsights(igUserId: string, accessToken: string): Promise<any> {
    const axios = (await import('axios')).default;
    this.logger.log(`Fetching Instagram insights for user: ${igUserId}`);

    // Instagram Login tokens (IG*) require 'me' instead of numeric user ID in URL paths.
    // Facebook Login tokens (EAA*) can use the numeric IG Business Account ID directly.
    const isNativeToken = accessToken?.startsWith('IG');
    const apiBase = isNativeToken
      ? 'https://graph.instagram.com/v22.0'
      : 'https://graph.facebook.com/v22.0';
    const targetUserId = isNativeToken ? 'me' : igUserId;

    this.logger.log(`IG Insights: isNativeToken=${isNativeToken}, apiBase=${apiBase}, targetUserId=${targetUserId}`);

    // ── Helper: extract value from either API format ──
    const extractInsightValue = (item: any): number => {
      if (!item) return 0;
      if (item.total_value !== undefined) {
        return typeof item.total_value === 'object'
          ? (item.total_value.value || 0)
          : (item.total_value || 0);
      }
      if (item.values && item.values.length > 0) {
        return item.values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
      }
      return 0;
    };

    // ── Helper: fetch account-level metrics (2-day window) ──
    const fetchMetricBatch = async (metrics: string[], period = 'day'): Promise<any[]> => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - (86400 * 2);
        const response = await axios.get(
          `${apiBase}/${targetUserId}/insights`,
          {
            params: {
              metric: metrics.join(','),
              period,
              metric_type: 'total_value',
              since: twoDaysAgo,
              until: now,
              access_token: accessToken,
            },
          },
        );
        return response.data?.data || [];
      } catch (err: any) {
        this.logger.warn(`IG Insights batch [${metrics.join(',')}] failed: ${err?.response?.data?.error?.message || err?.message}`);
        return [];
      }
    };

    // ── Helper: fetch insights for a single media item ──
    // Media-level insights work for ALL accounts regardless of follower count.
    // Per Meta docs: GET /{media-id}/insights?metric=reach,saved,likes,comments,shares,views
    const fetchMediaInsights = async (mediaId: string, mediaType: string): Promise<any> => {
      try {
        // 'views' replaces deprecated 'impressions'. 'reach','saved','likes','comments','shares' still work.
        const metrics = 'reach,saved,likes,comments,shares,views';
        const response = await axios.get(
          `${apiBase}/${mediaId}/insights`,
          {
            params: {
              metric: metrics,
              access_token: accessToken,
            },
          },
        );
        const data = response.data?.data || [];
        const out: any = {};
        data.forEach((item: any) => {
          out[item.name] = extractInsightValue(item);
        });
        return out;
      } catch (err: any) {
        this.logger.warn(`IG Media insights for ${mediaId} failed: ${err?.response?.data?.error?.message || err?.message}`);
        return {};
      }
    };

    // ── Helper: aggregate insights from individual posts ──
    // This is the FALLBACK for accounts with < 100 followers where account-level
    // insights return all zeros. Media-level insights always return real data.
    const aggregateFromPosts = async (): Promise<any> => {
      this.logger.log('IG Insights: Account-level metrics returned all 0s (likely < 100 followers). Aggregating from individual posts...');
      try {
        // Fetch up to 25 recent posts
        const mediaResponse = await axios.get(
          `${apiBase}/${targetUserId}/media`,
          {
            params: {
              fields: 'id,media_type,like_count,comments_count,timestamp',
              limit: 25,
              access_token: accessToken,
            },
          },
        );
        const posts = mediaResponse.data?.data || [];
        this.logger.log(`IG Aggregation: Found ${posts.length} posts to aggregate`);

        if (posts.length === 0) return null;

        let totalLikes = 0;
        let totalComments = 0;
        let totalReach = 0;
        let totalViews = 0;
        let totalSaves = 0;
        let totalShares = 0;

        // Fetch insights for each post in parallel (batches of 5 to avoid rate limits)
        const batchSize = 5;
        for (let i = 0; i < posts.length; i += batchSize) {
          const batch = posts.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((post: any) => fetchMediaInsights(post.id, post.media_type)),
          );
          results.forEach((insight: any) => {
            totalLikes += insight.likes || 0;
            totalComments += insight.comments || 0;
            totalReach += insight.reach || 0;
            totalViews += insight.views || 0;
            totalSaves += insight.saved || 0;
            totalShares += insight.shares || 0;
          });
        }

        // Also sum basic counts from the media list itself as a cross-check
        posts.forEach((post: any) => {
          // like_count and comments_count from the media list are always accurate
          // but we prefer insight-level data if available
        });

        this.logger.log(`IG Aggregated: likes=${totalLikes}, comments=${totalComments}, reach=${totalReach}, views=${totalViews}, saves=${totalSaves}, shares=${totalShares}`);

        return {
          likes: totalLikes,
          comments: totalComments,
          reach: totalReach,
          views: totalViews,
          saves: totalSaves,
          shares: totalShares,
          total_interactions: totalLikes + totalComments + totalShares + totalSaves,
          accounts_engaged: totalReach, // approximate
          lifetime_views: totalViews,
        };
      } catch (err: any) {
        this.logger.error(`IG post aggregation failed: ${err?.response?.data?.error?.message || err?.message}`);
        return null;
      }
    };

    try {
      // ── 1. Profile metadata (always works, no insights permission needed) ──
      const profileResponse = await axios.get(
        `${apiBase}/${targetUserId}`,
        {
          params: {
            fields: 'user_id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website',
            access_token: accessToken,
          },
        },
      ).catch((err: any) => {
        this.logger.error(`IG Profile Error: ${JSON.stringify(err?.response?.data || err?.message)}`);
        return { data: {} };
      });

      const profile = profileResponse.data || {};

      // ── 2. Assemble base result with profile data ──
      const result: any = {
        followers: profile.followers_count || 0,
        following: profile.follows_count || 0,
        total_posts: profile.media_count || 0,
        name: profile.name || null,
        username: profile.username || null,
        biography: profile.biography || null,
        website: profile.website || null,
        profilePicture: profile.profile_picture_url || null,
      };

      // ── 3. Try account-level insights (works for accounts with 100+ followers) ──
      const engagementData = await fetchMetricBatch(['accounts_engaged', 'reach', 'total_interactions']);
      const interactionData = await fetchMetricBatch(['likes', 'comments', 'shares', 'saves']);
      const additionalData = await fetchMetricBatch(['replies', 'reposts', 'profile_links_taps']);
      const followsData = await fetchMetricBatch(['follows_and_unfollows']);
      const viewsData = await fetchMetricBatch(['views']);

      const allInsights = [...engagementData, ...interactionData, ...additionalData, ...followsData, ...viewsData];

      // Parse account-level insight values
      allInsights.forEach((item: any) => {
        result[item.name] = extractInsightValue(item);
      });

      // ── 4. Check if account-level data is all zeros ──
      // Per Meta docs: "Some metrics are not available on Instagram accounts
      // with fewer than 100 followers" — they return 0 / empty instead.
      const interactionKeys = ['reach', 'views', 'likes', 'comments', 'shares', 'saves', 'total_interactions'];
      const allZeros = interactionKeys.every(k => !result[k] || result[k] === 0);

      if (allZeros && (profile.media_count || 0) > 0) {
        // ── 5. FALLBACK: Aggregate from individual post insights ──
        const aggregated = await aggregateFromPosts();
        if (aggregated) {
          // Merge aggregated data into result (only overwrite zeros)
          Object.keys(aggregated).forEach(key => {
            if (!result[key] || result[key] === 0) {
              result[key] = aggregated[key];
            }
          });
          result._source = 'aggregated_from_posts';
        }
      } else {
        result._source = 'account_level_insights';
      }

      // Set lifetime_views if not already set
      if (!result.lifetime_views) {
        result.lifetime_views = result.views || 0;
      }

      // Fallback: if 'reach' is still 0 but 'views' has data, use views as reach
      if (!result.reach && result.views) {
        result.reach = result.views;
      }

      this.logger.log(`IG Final result (source: ${result._source}): ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to fetch IG insights: ${err?.response?.data?.error?.message || err.message}`);
      return { followers: 0, total_posts: 0 };
    }
  }
}
