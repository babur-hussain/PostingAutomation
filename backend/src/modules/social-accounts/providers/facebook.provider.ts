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
   * Get basic insights for a Facebook Page.
   */
  async getPageInsights(accessToken: string, pageId: string): Promise<any> {
    const axios = (await import('axios')).default;
    this.logger.log(`Fetching Facebook insights for page: ${pageId}`);
    try {
      // 1. Fetch metrics
      const response = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/insights`,
        {
          params: {
            metric: 'page_impressions,page_post_engagements,page_fans,page_views_total,page_video_views',
            period: 'day',
            access_token: accessToken,
          },
        },
      ).catch(() => ({ data: { data: [] } }));

      // 2. Fetch basic counts and profile metadata
      const profileResponse = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}`,
        {
          params: {
            fields: 'followers_count,fan_count,about,bio,description,category,website,name,username',
            access_token: accessToken,
          },
        },
      ).catch(() => ({ data: {} }));

      const data = response.data?.data || [];
      const result: any = {
        followers: profileResponse.data.followers_count || profileResponse.data.fan_count || 0,
        name: profileResponse.data.name || null,
        username: profileResponse.data.username || null,
        about: profileResponse.data.about || profileResponse.data.bio || profileResponse.data.description || null,
        category: profileResponse.data.category || null,
        website: profileResponse.data.website || null,
      };

      data.forEach((item: any) => {
        // Facebook returns an array of values for different days, get the most recent one
        result[item.name] = item.values[item.values.length - 1]?.value || 0;
      });
      return result;
    } catch (err: any) {
      this.logger.error(`Failed to fetch FB insights: ${err?.response?.data?.error?.message || err.message}`);
      return { followers: 0, page_impressions: 0, page_post_engagements: 0, page_fans: 0 };
    }
  }
}
