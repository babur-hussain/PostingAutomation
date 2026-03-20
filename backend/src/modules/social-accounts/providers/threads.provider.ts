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
}
