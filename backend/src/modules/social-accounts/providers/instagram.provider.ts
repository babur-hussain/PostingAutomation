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
   */
  static readonly SCOPES = [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ];

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.appId = this.configService.get<string>('meta.instagramAppId') || '';
    this.appSecret = this.configService.get<string>('meta.instagramAppSecret') || '';
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

    this.logger.log(`Exchanging code for token with redirect_uri: ${this.redirectUri}`);

    const response = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      formData.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    this.logger.log(`Token exchange raw response: ${JSON.stringify(response.data)}`);

    // Response: { data: [{ access_token, user_id, permissions }] }
    const tokenData = response.data.data?.[0] || response.data;

    this.logger.log(`Parsed token data - user_id: ${tokenData.user_id}, has_token: ${!!tokenData.access_token}`);

    return {
      accessToken: tokenData.access_token,
      userId: tokenData.user_id?.toString(),
    };
  }

  /**
   * Exchange short-lived token for long-lived token (~60 days).
   * Tries multiple URL/method combinations since Meta's API behavior varies.
   */
  async getLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;

    this.logger.log(`Exchanging short-lived token for long-lived token... (token length: ${shortLivedToken?.length})`);

    const params = {
      grant_type: 'ig_exchange_token',
      client_secret: this.appSecret,
      access_token: shortLivedToken,
    };

    // Try multiple URL + method combinations
    const attempts = [
      { method: 'GET', url: 'https://graph.instagram.com/access_token' },
      { method: 'GET', url: 'https://graph.instagram.com/v21.0/access_token' },
      { method: 'GET', url: 'https://graph.instagram.com/v22.0/access_token' },
      { method: 'POST', url: 'https://graph.instagram.com/access_token' },
      { method: 'POST', url: 'https://graph.instagram.com/v21.0/access_token' },
    ];

    for (const attempt of attempts) {
      try {
        this.logger.log(`Trying ${attempt.method} ${attempt.url}...`);
        let response: any;
        if (attempt.method === 'GET') {
          response = await axios.get(attempt.url, { params });
        } else {
          response = await axios.post(
            attempt.url,
            new URLSearchParams(params as any).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
          );
        }

        this.logger.log(`SUCCESS with ${attempt.method} ${attempt.url}: ${JSON.stringify(response.data)}`);
        const tokenData = response.data.data?.[0] || response.data;

        return {
          accessToken: tokenData.access_token,
          expiresIn: tokenData.expires_in || 5184000,
        };
      } catch (err) {
        const errBody = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
        this.logger.warn(`${attempt.method} ${attempt.url} failed: ${errBody}`);
      }
    }

    this.logger.error('All long-lived token exchange attempts failed');
    throw new Error('Failed to exchange short-lived token for long-lived token');
  }

  /**
   * Get Instagram user profile info.
   * GET https://graph.instagram.com/v21.0/me
   */
  async getUserProfile(accessToken: string): Promise<{
    userId: string;
    username: string;
    name: string;
    profilePictureUrl?: string;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get(
      'https://graph.instagram.com/v21.0/me',
      {
        params: {
          fields: 'user_id,username,name,profile_picture_url',
          access_token: accessToken,
        },
      },
    );

    return {
      userId: response.data.user_id?.toString() || response.data.id,
      username: response.data.username,
      name: response.data.name || response.data.username,
      profilePictureUrl: response.data.profile_picture_url,
    };
  }
}
