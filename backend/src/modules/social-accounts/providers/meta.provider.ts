import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const GRAPH_API_VERSION = 'v25.0';

/**
 * Shared Meta (Facebook/Instagram) OAuth provider.
 * Handles OAuth URL generation, token exchange, and token refresh.
 * Follows Meta's official manual login flow:
 * https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */
@Injectable()
export class MetaProvider {
  private readonly logger = new Logger(MetaProvider.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('meta.appId') || '';
    this.appSecret = this.configService.get<string>('meta.appSecret') || '';
    this.redirectUri = this.configService.get<string>('meta.redirectUri') || '';
  }

  /**
   * Generate the Meta OAuth authorization URL.
   * Per Meta docs: https://www.facebook.com/v21.0/dialog/oauth?client_id=...
   */
  getAuthorizationUrl(scopes: string[], state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(','),
      response_type: 'code',
      state,
      locale: 'en_US',
    });
    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token.
   * https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#confirm
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          client_id: this.appId,
          client_secret: this.appSecret,
          redirect_uri: this.redirectUri,
          code,
        },
      },
    );

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
    };
  }

  /**
   * Exchange short-lived token for long-lived token (~60 days).
   * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
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
   * https://developers.facebook.com/docs/graph-api/securing-requests
   */
  generateAppSecretProof(accessToken: string): string {
    return crypto
      .createHmac('sha256', this.appSecret)
      .update(accessToken)
      .digest('hex');
  }

  /**
   * Get user profile from Meta Graph API.
   */
  async getUserProfile(accessToken: string): Promise<{
    id: string;
    name: string;
    picture?: string;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me`,
      {
        params: {
          access_token: accessToken,
          appsecret_proof: this.generateAppSecretProof(accessToken),
          fields: 'id,name,picture',
        },
      },
    );
    return {
      id: response.data.id,
      name: response.data.name,
      picture: response.data.picture?.data?.url,
    };
  }

  /**
   * Get user's Facebook Pages.
   * https://developers.facebook.com/docs/pages-api/overview
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

    return (response.data.data || []).map((page: any) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      picture: page.picture?.data?.url,
    }));
  }

  /**
   * Get Instagram Business Account linked to a Facebook Page.
   * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
   */
  async getInstagramBusinessAccount(
    pageId: string,
    pageAccessToken: string,
  ): Promise<{ igBusinessAccountId: string } | null> {
    const axios = (await import('axios')).default;
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}`,
        {
          params: {
            access_token: pageAccessToken,
            appsecret_proof: this.generateAppSecretProof(pageAccessToken),
            fields: 'instagram_business_account',
          },
        },
      );

      const igAccount = response.data.instagram_business_account;
      return igAccount ? { igBusinessAccountId: igAccount.id } : null;
    } catch (error) {
      this.logger.warn(
        `Failed to get IG account for page ${pageId}`,
        error?.response?.data || error.message,
      );
      return null;
    }
  }
}
