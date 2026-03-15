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
   * GET https://graph.instagram.com/v21.0/me
   */
  async getUserProfile(accessToken: string): Promise<{
    userId: string;
    username: string;
    name: string;
    profilePictureUrl?: string;
  }> {
    const axios = (await import('axios')).default;
    const response = await axios.get('https://graph.instagram.com/v21.0/me', {
      params: {
        fields: 'user_id,username,name,profile_picture_url',
        access_token: accessToken,
      },
    });

    return {
      userId: response.data.user_id?.toString() || response.data.id,
      username: response.data.username,
      name: response.data.name || response.data.username,
      profilePictureUrl: response.data.profile_picture_url,
    };
  }
}
