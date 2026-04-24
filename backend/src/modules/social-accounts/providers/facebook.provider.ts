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
   * Fetches metrics in safe batches. If all page-level metrics are 0 (happens for
   * pages with < 100 likes per Meta docs), falls back to aggregating from individual posts.
   * Reference: https://developers.facebook.com/docs/graph-api/reference/v25.0/insights
   */
  async getPageInsights(accessToken: string, pageId: string): Promise<any> {
    const axios = (await import('axios')).default;
    const apiBase = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
    this.logger.log(`Fetching Facebook insights for page: ${pageId}`);

    // Helper: fetch a batch of page-level metrics safely
    const fetchMetricBatch = async (metrics: string[], period = 'day'): Promise<any[]> => {
      try {
        const response = await axios.get(
          `${apiBase}/${pageId}/insights`,
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

    // Helper: fetch engagement data for a single post
    const fetchPostEngagement = async (postId: string): Promise<any> => {
      try {
        const response = await axios.get(
          `${apiBase}/${postId}`,
          {
            params: {
              fields: 'shares,likes.summary(true),comments.summary(true)',
              access_token: accessToken,
            },
          },
        );
        const data = response.data;
        const out = {
          likes: data.likes?.summary?.total_count || 0,
          comments: data.comments?.summary?.total_count || 0,
          shares: data.shares?.count || 0,
          reach: 0,
          impressions: 0,
        };
        // Try to also get reach/impressions from post insights
        try {
          const insightsRes = await axios.get(
            `${apiBase}/${postId}/insights`,
            {
              params: {
                metric: 'post_impressions,post_impressions_unique',
                access_token: accessToken,
              },
            },
          );
          (insightsRes.data?.data || []).forEach((insight: any) => {
            if (insight.name === 'post_impressions_unique') {
              out.reach = insight.values?.[0]?.value || 0;
            }
            if (insight.name === 'post_impressions') {
              out.impressions = insight.values?.[0]?.value || 0;
            }
          });
        } catch {
          // Post insights may not be available for all posts
        }
        return out;
      } catch (err: any) {
        this.logger.warn(`FB Post engagement for ${postId} failed: ${err?.response?.data?.error?.message || err?.message}`);
        return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
      }
    };

    // Helper: aggregate insights from individual posts (fallback for pages < 100 likes)
    const aggregateFromPosts = async (): Promise<any> => {
      this.logger.log('FB Insights: Page-level metrics returned all 0s (likely < 100 likes). Aggregating from individual posts...');
      try {
        const mediaResponse = await axios.get(
          `${apiBase}/${pageId}/published_posts`,
          {
            params: {
              fields: 'id,created_time',
              limit: 25,
              access_token: accessToken,
            },
          },
        );
        const posts = mediaResponse.data?.data || [];
        this.logger.log(`FB Aggregation: Found ${posts.length} posts to aggregate`);
        if (posts.length === 0) return null;

        let totalLikes = 0;
        let totalComments = 0;
        let totalShares = 0;
        let totalReach = 0;
        let totalImpressions = 0;

        const batchSize = 5;
        for (let i = 0; i < posts.length; i += batchSize) {
          const batch = posts.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((post: any) => fetchPostEngagement(post.id)),
          );
          results.forEach((eng: any) => {
            totalLikes += eng.likes || 0;
            totalComments += eng.comments || 0;
            totalShares += eng.shares || 0;
            totalReach += eng.reach || 0;
            totalImpressions += eng.impressions || 0;
          });
        }

        this.logger.log(`FB Aggregated: likes=${totalLikes}, comments=${totalComments}, shares=${totalShares}, reach=${totalReach}, impressions=${totalImpressions}`);
        return {
          page_post_engagements: totalLikes + totalComments + totalShares,
          page_posts_impressions: totalImpressions,
          page_posts_impressions_unique: totalReach,
          page_media_view: totalImpressions,
          total_likes: totalLikes,
          total_comments: totalComments,
          total_shares: totalShares,
        };
      } catch (err: any) {
        this.logger.error(`FB post aggregation failed: ${err?.response?.data?.error?.message || err?.message}`);
        return null;
      }
    };

    try {
      // ── 1. Profile metadata (always works, no read_insights needed) ──
      const profileResponse = await axios.get(
        `${apiBase}/${pageId}`,
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

      // ── 2. Assemble base result ──
      const result: any = {
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

      // ── 3. Try page-level insights ──
      const engagementData = await fetchMetricBatch([
        'page_post_engagements',
        'page_total_actions',
        'page_daily_follows',
        'page_daily_follows_unique',
        'page_daily_unfollows_unique',
        'page_follows',
      ]);
      const viewsData = await fetchMetricBatch(['page_views_total']);
      const videoData = await fetchMetricBatch([
        'page_video_views',
        'page_video_views_unique',
        'page_video_complete_views_30s',
      ]);
      const mediaData = await fetchMetricBatch(['page_media_view']);
      const postImpressionData = await fetchMetricBatch([
        'page_posts_impressions',
        'page_posts_impressions_unique',
      ]);

      // Merge all insight batches
      const allInsights = [...engagementData, ...viewsData, ...videoData, ...mediaData, ...postImpressionData];
      this.logger.log(`FB Insights received ${allInsights.length} metric items`);

      allInsights.forEach((item: any) => {
        const val = item.values?.[item.values.length - 1]?.value;
        result[item.name] = val !== undefined ? val : 0;
      });

      // ── 4. Check if page-level data is all zeros (pages with < 100 likes) ──
      const insightKeys = [
        'page_post_engagements', 'page_views_total', 'page_video_views',
        'page_media_view', 'page_posts_impressions', 'page_posts_impressions_unique',
      ];
      const allZeros = insightKeys.every(k => !result[k] || result[k] === 0);

      if (allZeros) {
        // ── 5. FALLBACK: Aggregate from individual post data ──
        const aggregated = await aggregateFromPosts();
        if (aggregated) {
          Object.keys(aggregated).forEach(key => {
            if (!result[key] || result[key] === 0) {
              result[key] = aggregated[key];
            }
          });
          result._source = 'aggregated_from_posts';
        }
      } else {
        result._source = 'page_level_insights';
      }

      this.logger.log(`FB Final result (source: ${result._source}): keys=${Object.keys(result).join(', ')}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to fetch FB insights: ${err?.response?.data?.error?.message || err.message}`);
      return { followers: 0, page_post_engagements: 0, page_fans: 0 };
    }
  }
}
