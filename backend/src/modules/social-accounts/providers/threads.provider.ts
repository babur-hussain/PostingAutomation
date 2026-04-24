import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Standalone Threads OAuth provider.
 * Handles OAuth URL generation, token exchange, and token refresh exclusively for Threads.
 */
@Injectable()
export class ThreadsProvider {
  private readonly logger = new Logger(ThreadsProvider.name);

  // Threads specific requested scopes
  static readonly SCOPES = [
    'threads_basic',
    'threads_content_publish',
    'threads_read_replies',
    'threads_manage_replies',
    'threads_manage_insights',
    'threads_manage_mentions',
    'threads_profile_discovery',
    'threads_keyword_search',
    'threads_location_tagging',
    'threads_delete',
  ];

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('threads.appId') || '';
    this.appSecret = this.configService.get<string>('threads.appSecret') || '';
    this.redirectUri = this.configService.get<string>('threads.redirectUri') || '';
  }

  /**
   * Generate the Threads OAuth authorization URL.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: ThreadsProvider.SCOPES.join(','),
      response_type: 'code',
      state,
    });
    return `https://threads.net/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token.
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    userId: string;
  }> {
    const axios = (await import('axios')).default;

    const cleanCode = code.replace(/#_=_$/, '').replace(/#_$/, '');

    this.logger.log(`Exchanging code for Threads token with redirect_uri: ${this.redirectUri}`);

    const form = new URLSearchParams();
    form.append('client_id', this.appId);
    form.append('client_secret', this.appSecret);
    form.append('grant_type', 'authorization_code');
    form.append('redirect_uri', this.redirectUri);
    form.append('code', cleanCode);

    try {
      const response = await axios.post(
        `https://graph.threads.net/oauth/access_token`,
        form.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.logger.log('Successfully exchanged code for Threads token');

      return {
        accessToken: response.data.access_token,
        userId: response.data.user_id,
      };
    } catch (error: any) {
      this.logger.error(`Threads Token exchange failed: ${JSON.stringify(error?.response?.data || error?.message)}`);
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
      `https://graph.threads.net/access_token`,
      {
        params: {
          grant_type: 'th_exchange_token',
          client_secret: this.appSecret,
          access_token: shortLivedToken,
        },
      },
    );

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in || 5184000,
    };
  }

  /**
   * Get user's Threads profile information
   */
  async getUserProfile(accessToken: string): Promise<{
    id: string;
    username: string;
    name: string;
    threadsProfilePictureUrl?: string;
  }> {
    const axios = (await import('axios')).default;

    this.logger.log(`Fetching Threads profile`);

    try {
      const response = await axios.get(
        `https://graph.threads.net/v1.0/me`,
        {
          params: {
            fields: 'id,username,threads_profile_picture_url',
            access_token: accessToken,
          },
        },
      );

      this.logger.log(`Successfully fetched Threads profile for: ${response.data.username}`);

      return {
        id: response.data.id,
        username: response.data.username,
        name: response.data.username,
        threadsProfilePictureUrl: response.data.threads_profile_picture_url,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching Threads profile: ${JSON.stringify(error?.response?.data || error?.message)}`);
      throw error;
    }
  }

  /**
   * Fetch comprehensive account analytics for Threads.
   * Uses a two-tier approach:
   * 1. User-level insights via GET /{user-id}/threads_insights (90-day window)
   * 2. Post-level aggregation by summing individual post insights
   * Returns the best available value for each metric.
   */
  async getAccountAnalytics(accountId: string, accessToken: string): Promise<any> {
    const axios = (await import('axios')).default;
    const apiBase = 'https://graph.threads.net/v1.0';
    this.logger.log(`Fetching analytics for Threads account: ${accountId}`);

    const result: any = {
      total_threads: 0,
      total_views: 0,
      total_likes: 0,
      total_replies: 0,
      total_reposts: 0,
      total_quotes: 0,
      followers: 0,
      username: null,
      name: null,
      profilePicture: null,
      biography: null,
    };

    // ── 1. Fetch profile metadata ──
    try {
      const profileRes = await axios.get(`${apiBase}/me`, {
        params: {
          fields: 'id,username,threads_profile_picture_url,threads_biography',
          access_token: accessToken,
        },
      });
      const profile = profileRes.data || {};
      result.username = profile.username || null;
      result.name = profile.username || null;
      result.profilePicture = profile.threads_profile_picture_url || null;
      result.biography = profile.threads_biography || null;
    } catch (err: any) {
      this.logger.warn(`Threads profile fetch failed: ${err?.response?.data?.error?.message || err?.message}`);
    }

    // ── 2. User-level insights (90-day window) ──
    // GET /{user-id}/threads_insights?metric=views,likes,replies,reposts,quotes&since=...&until=...
    try {
      const now = Math.floor(Date.now() / 1000);
      const ninetyDaysAgo = now - (86400 * 90);
      const userInsightsRes = await axios.get(`${apiBase}/${accountId}/threads_insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes',
          since: ninetyDaysAgo,
          until: now,
          access_token: accessToken,
        },
      });
      const userInsights = userInsightsRes.data?.data || [];
      userInsights.forEach((insight: any) => {
        const val = insight.values?.[0]?.value || 0;
        if (insight.name === 'views') result.total_views = val;
        if (insight.name === 'likes') result.total_likes = val;
        if (insight.name === 'replies') result.total_replies = val;
        if (insight.name === 'reposts') result.total_reposts = val;
        if (insight.name === 'quotes') result.total_quotes = val;
      });
      this.logger.log(`Threads user-level insights: views=${result.total_views}, likes=${result.total_likes}, replies=${result.total_replies}, reposts=${result.total_reposts}`);
    } catch (err: any) {
      this.logger.warn(`Threads user-level insights failed: ${err?.response?.data?.error?.message || err?.message}`);
    }

    // ── 3. Fetch followers_count separately (no since/until support) ──
    try {
      const followersRes = await axios.get(`${apiBase}/${accountId}/threads_insights`, {
        params: {
          metric: 'followers_count',
          access_token: accessToken,
        },
      });
      const followersData = followersRes.data?.data || [];
      if (followersData.length > 0) {
        result.followers = followersData[0].total_value?.value || followersData[0].values?.[0]?.value || 0;
      }
    } catch (err: any) {
      this.logger.warn(`Threads followers_count fetch failed: ${err?.response?.data?.error?.message || err?.message}`);
    }

    // ── 4. Post-level aggregation fallback ──
    // If user-level insights returned all zeros, aggregate from individual posts
    const userLevelAllZeros = !result.total_views && !result.total_likes && !result.total_replies && !result.total_reposts;

    try {
      const postsResponse = await axios.get(`${apiBase}/${accountId}/threads`, {
        params: { fields: 'id', limit: 25, access_token: accessToken },
      });
      const posts = postsResponse.data?.data || [];
      result.total_threads = posts.length;

      if (userLevelAllZeros && posts.length > 0) {
        this.logger.log(`Threads: User-level insights returned all 0s. Aggregating from ${posts.length} individual posts...`);

        let aggViews = 0, aggLikes = 0, aggReplies = 0, aggReposts = 0, aggQuotes = 0;

        // Fetch insights in batches of 5
        const batchSize = 5;
        for (let i = 0; i < posts.length; i += batchSize) {
          const batch = posts.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((p: any) =>
              axios.get(`${apiBase}/${p.id}/insights`, {
                params: { metric: 'views,likes,replies,reposts,quotes', access_token: accessToken },
              }).catch(() => null),
            ),
          );
          results.forEach((res: any) => {
            if (res?.data?.data) {
              res.data.data.forEach((insight: any) => {
                const val = insight.values?.[0]?.value || 0;
                if (insight.name === 'views') aggViews += val;
                if (insight.name === 'likes') aggLikes += val;
                if (insight.name === 'replies') aggReplies += val;
                if (insight.name === 'reposts') aggReposts += val;
                if (insight.name === 'quotes') aggQuotes += val;
              });
            }
          });
        }

        this.logger.log(`Threads aggregated: views=${aggViews}, likes=${aggLikes}, replies=${aggReplies}, reposts=${aggReposts}, quotes=${aggQuotes}`);

        // Use aggregated values if they're better than user-level
        if (aggViews > result.total_views) result.total_views = aggViews;
        if (aggLikes > result.total_likes) result.total_likes = aggLikes;
        if (aggReplies > result.total_replies) result.total_replies = aggReplies;
        if (aggReposts > result.total_reposts) result.total_reposts = aggReposts;
        if (aggQuotes > result.total_quotes) result.total_quotes = aggQuotes;
        result._source = 'aggregated_from_posts';
      } else {
        result._source = 'user_level_insights';
      }
    } catch (err: any) {
      this.logger.error(`Failed to fetch Threads posts: ${err?.response?.data?.error?.message || err?.message}`);
    }

    this.logger.log(`Threads Final result (source: ${result._source}): ${JSON.stringify(result)}`);
    return result;
  }
}
