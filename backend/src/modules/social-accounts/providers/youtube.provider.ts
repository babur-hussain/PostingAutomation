import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * YouTube / Google OAuth 2.0 provider.
 *
 * Flow:
 * 1. Auth URL: https://accounts.google.com/o/oauth2/auth
 * 2. Token exchange: POST https://oauth2.googleapis.com/token
 * 3. Channel info: GET https://www.googleapis.com/youtube/v3/channels
 */
@Injectable()
export class YouTubeProvider {
  private readonly logger = new Logger(YouTubeProvider.name);

  static readonly SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ];

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(private configService: ConfigService) {
    this.clientId = this.configService.get<string>('youtube.clientId') || '';
    this.clientSecret =
      this.configService.get<string>('youtube.clientSecret') || '';
    this.redirectUri =
      this.configService.get<string>('youtube.redirectUri') || '';
  }

  /**
   * Generate Google OAuth authorization URL for YouTube access.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: YouTubeProvider.SCOPES.join(' '),
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Always show consent to get refresh token
      state,
    });
    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access + refresh tokens.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;

    try {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      this.logger.log('Successfully exchanged code for YouTube tokens');

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in || 3600,
      };
    } catch (error: any) {
      if (error.response?.data) {
        this.logger.error(
          `YouTube Token Exchange Error: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const axios = (await import('axios')).default;

    try {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in || 3600,
      };
    } catch (error: any) {
      if (error.response?.data) {
        this.logger.error(
          `YouTube Token Refresh Error: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Get the authenticated user's YouTube channel info.
   */
  async getChannelInfo(accessToken: string): Promise<{
    channelId: string;
    channelTitle: string;
    thumbnailUrl?: string;
  }> {
    const axios = (await import('axios')).default;

    const response = await axios.get(
      'https://www.googleapis.com/youtube/v3/channels',
      {
        params: {
          part: 'snippet',
          mine: true,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const channel = response.data.items?.[0];
    if (!channel) {
      throw new Error('No YouTube channel found for this account');
    }

    return {
      channelId: channel.id,
      channelTitle: channel.snippet.title,
      thumbnailUrl: channel.snippet.thumbnails?.default?.url,
    };
  }
}
