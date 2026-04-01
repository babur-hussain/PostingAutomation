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
      ? 'https://graph.instagram.com/v21.0'
      : 'https://graph.facebook.com/v21.0';
    const targetUserId = isNativeToken ? 'me' : igUserId;

    this.logger.log(`IG Insights: isNativeToken=${isNativeToken}, apiBase=${apiBase}, targetUserId=${targetUserId}`);

    // Helper: fetch a batch of metrics safely
    const fetchMetricBatch = async (metrics: string[], period = 'day'): Promise<any[]> => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - (86400 * 2); // 2 days back to ensure data exists

        const response = await axios.get(
          `${apiBase}/${targetUserId}/insights`,
          {
            params: {
              metric: metrics.join(','),
              period,
              metric_type: 'total_value',
              since: oneDayAgo,
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

    try {
      // ── 1. Profile metadata (always works) ──
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
      this.logger.log(`IG Profile raw data: ${JSON.stringify(profile)}`);

      // ── 2. Insights: fetch in safe batches ──
      // Batch 1: Reach & engagement core
      const engagementData = await fetchMetricBatch([
        'accounts_engaged',
        'reach',
        'total_interactions',
      ]);

      // Batch 2: Content interaction specifics
      const interactionData = await fetchMetricBatch([
        'likes',
        'comments',
        'shares',
        'saves',
      ]);

      // Batch 3: Additional engagement
      const additionalData = await fetchMetricBatch([
        'replies',
        'reposts',
        'profile_links_taps',
      ]);

      // Batch 4: Follows
      const followsData = await fetchMetricBatch([
        'follows_and_unfollows',
      ]);

      // Batch 5: Views
      const viewsData = await fetchMetricBatch([
        'views',
      ]);

      // ── 3. Assemble result ──
      const result: any = {
        // Profile metadata
        followers: profile.followers_count || 0,
        following: profile.follows_count || 0,
        total_posts: profile.media_count || 0,
        name: profile.name || null,
        username: profile.username || null,
        biography: profile.biography || null,
        website: profile.website || null,
        profilePicture: profile.profile_picture_url || null,
      };

      // Merge all insight batches
      // Instagram insights use total_value.value format
      const allInsights = [...engagementData, ...interactionData, ...additionalData, ...followsData, ...viewsData];
      this.logger.log(`IG Insights received ${allInsights.length} metric items`);

      allInsights.forEach((item: any) => {
        // Handle total_value format (new Instagram API)
        if (item.total_value !== undefined) {
          if (typeof item.total_value === 'object' && item.total_value.value !== undefined) {
            result[item.name] = item.total_value.value;
          } else {
            result[item.name] = item.total_value;
          }
        }
        // Handle legacy values[] format (fallback)
        else if (item.values && item.values.length > 0) {
          result[item.name] = item.values[item.values.length - 1]?.value || 0;
        }
      });

      this.logger.log(`IG Final result keys: ${Object.keys(result).join(', ')}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to fetch IG insights: ${err?.response?.data?.error?.message || err.message}`);
      return { followers: 0, total_posts: 0 };
    }
  }
}
