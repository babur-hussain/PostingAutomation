import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const GRAPH_API_VERSION = 'v19.0';

/**
 * Standalone Facebook OAuth provider.
 * Handles OAuth URL generation, token exchange, and token refresh exclusively for Facebook.
 */
@Injectable()
export class FacebookProvider {
  private readonly logger = new Logger(FacebookProvider.name);

  // Facebook Pages specific requested scopes
  static readonly SCOPES = [
    'pages_manage_posts',
    'pages_read_engagement',
    'pages_read_user_content',
    'read_insights',
    'pages_show_list',
  ];

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('facebook.appId') || '';
    this.appSecret = this.configService.get<string>('facebook.appSecret') || '';
    this.redirectUri = this.configService.get<string>('facebook.redirectUri') || '';
  }

  /**
   * Generate the Facebook OAuth authorization URL.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: FacebookProvider.SCOPES.join(','),
      response_type: 'code',
      state,
      locale: 'en_US',
    });
    const url = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
    this.logger.debug(`[FacebookProvider] Generated Auth URL: ${url}`);
    
    // Also verify app ID is loaded on server
    if (!this.appId) {
      this.logger.error('[FacebookProvider] FATAL: appId is empty! Check environment variables (FACEBOOK_APP_ID).');
    }
    
    return url;
  }

  /**
   * Exchange authorization code for access token.
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;

    // Facebook sometimes appends #_=_ to the authorization code — strip it
    const cleanCode = code.replace(/#_=_$/, '').replace(/#_$/, '');

    this.logger.log(`Exchanging code for token with redirect_uri: ${this.redirectUri}`);

    try {
      const response = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
        {
          params: {
            client_id: this.appId,
            client_secret: this.appSecret,
            redirect_uri: this.redirectUri,
            code: cleanCode,
          },
        },
      );

      this.logger.log('Successfully exchanged code for token');

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error: any) {
      this.logger.error(`Token exchange failed: ${JSON.stringify(error?.response?.data || error?.message)}`);
      throw error;
    }
  }

  /**
   * Exchange short-lived token for long-lived token (~60 days).
   */
  async getLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: shortLivedToken,
        },
      },
    );

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in || 5184000, // ~60 days default
    };
  }

  /**
   * Generate appsecret_proof for secure API calls.
   */
  generateAppSecretProof(accessToken: string): string {
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(accessToken)
      .digest('hex');
  }

  /**
   * Get user's Facebook Pages.
   */
  async getUserPages(accessToken: string): Promise<
    Array<{
      id: string;
      name: string;
      accessToken: string;
      picture?: string;
    }>
  > {
    const axios = (await import('axios')).default;

    this.logger.log(`Fetching Facebook Pages for user token (truncated): ${accessToken.substring(0, 10)}...`);

    try {
      const response = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts`,
        {
          params: {
            access_token: accessToken,
            appsecret_proof: this.generateAppSecretProof(accessToken),
            fields: 'id,name,access_token,picture',
          },
        },
      );

      this.logger.log(`Raw /me/accounts response data: ${JSON.stringify(response.data)}`);

      return (response.data.data || []).map((page: any) => ({
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        picture: page.picture?.data?.url,
      }));
    } catch (error: any) {
      this.logger.error(`Error fetching Facebook Pages: ${JSON.stringify(error?.response?.data || error?.message)}`);
      throw error;
    }
  }

  /**
   * Get comprehensive insights for a Facebook Page.
   * Fetches metrics in safe batches to avoid a single deprecated metric killing the entire request.
   * Reference: https://developers.facebook.com/docs/graph-api/reference/page/insights/
   */
  async getPageInsights(accessToken: string, pageId: string): Promise<any> {
    const axios = (await import('axios')).default;
    this.logger.log(`Fetching Facebook insights for page: ${pageId}`);

    // Helper: fetch a batch of metrics safely
    const fetchMetricBatch = async (metrics: string[], period = 'day'): Promise<any[]> => {
      try {
        const response = await axios.get(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/insights`,
          {
            params: {
              metric: metrics.join(','),
              period,
              access_token: accessToken,
            },
          },
        );
        return response.data?.data || [];
      } catch (err: any) {
        this.logger.warn(`FB Insights batch [${metrics.join(',')}] failed: ${err?.response?.data?.error?.message || err?.message}`);
        return [];
      }
    };

    try {
      // ── 1. Profile metadata (always works, no read_insights needed) ──
      const profileResponse = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}`,
        {
          params: {
            fields: 'followers_count,fan_count,about,bio,description,category,website,name,username,picture.width(200),cover,new_like_count,talking_about_count,were_here_count,rating_count,overall_star_rating,phone,single_line_address,link',
            access_token: accessToken,
          },
        },
      ).catch((err: any) => {
        this.logger.error(`FB Profile Metadata Error: ${JSON.stringify(err?.response?.data || err?.message)}`);
        return { data: {} };
      });

      const profile = profileResponse.data || {};
      this.logger.log(`FB Profile raw data: ${JSON.stringify(profile)}`);

      // ── 2. Insights: fetch in safe batches ──
      // Batch 1: Engagement metrics
      const engagementData = await fetchMetricBatch([
        'page_post_engagements',
        'page_total_actions',
        'page_daily_follows',
        'page_daily_follows_unique',
        'page_daily_unfollows_unique',
        'page_follows',
      ]);

      // Batch 2: Views metrics
      const viewsData = await fetchMetricBatch([
        'page_views_total',
      ]);

      // Batch 3: Video metrics
      const videoData = await fetchMetricBatch([
        'page_video_views',
        'page_video_views_unique',
        'page_video_complete_views_30s',
      ]);

      // Batch 4: Media view metrics
      const mediaData = await fetchMetricBatch([
        'page_media_view',
      ]);

      // Batch 5: Post impressions
      const postImpressionData = await fetchMetricBatch([
        'page_posts_impressions',
        'page_posts_impressions_unique',
      ]);

      // ── 3. Assemble result ──
      const result: any = {
        // Profile metadata
        followers: profile.followers_count || profile.fan_count || 0,
        page_fans: profile.fan_count || profile.followers_count || 0,
        name: profile.name || null,
        username: profile.username || null,
        about: profile.about || profile.bio || profile.description || null,
        category: profile.category || null,
        website: profile.website || null,
        profilePicture: profile.picture?.data?.url || null,
        coverPhoto: profile.cover?.source || null,
        link: profile.link || null,
        phone: profile.phone || null,
        address: profile.single_line_address || null,
        talking_about_count: profile.talking_about_count || 0,
        were_here_count: profile.were_here_count || 0,
        new_like_count: profile.new_like_count || 0,
        rating_count: profile.rating_count || 0,
        overall_star_rating: profile.overall_star_rating || 0,
      };

      // Merge all insight batches
      const allInsights = [...engagementData, ...viewsData, ...videoData, ...mediaData, ...postImpressionData];
      this.logger.log(`FB Insights received ${allInsights.length} metric items`);

      allInsights.forEach((item: any) => {
        const val = item.values?.[item.values.length - 1]?.value;
        result[item.name] = val !== undefined ? val : 0;
      });

      this.logger.log(`FB Final result keys: ${Object.keys(result).join(', ')}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to fetch FB insights: ${err?.response?.data?.error?.message || err.message}`);
      return { followers: 0, page_post_engagements: 0, page_fans: 0 };
    }
  }
}
