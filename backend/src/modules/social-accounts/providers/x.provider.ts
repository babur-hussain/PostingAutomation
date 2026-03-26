import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwitterApi } from 'twitter-api-v2';
import Redis from 'ioredis';

@Injectable()
export class XProvider {
  private readonly logger = new Logger(XProvider.name);
  private client: TwitterApi;
  private redis: Redis;

  constructor(private configService: ConfigService) {
    const appKey = this.configService.get<string>('x.consumerKey');
    const appSecret = this.configService.get<string>('x.consumerSecret');

    this.client = new TwitterApi({
      appKey: appKey || '',
      appSecret: appSecret || '',
    });

    this.redis = new Redis({
      host: this.configService.get<string>('redis.host') || 'localhost',
      port: this.configService.get<number>('redis.port') || 6379,
      password: this.configService.get<string>('redis.password') || undefined,
      tls: this.configService.get<boolean>('redis.tls') ? {} : undefined,
    });

    this.logger.log('X (Twitter) Provider initialized for OAuth 1.0a');
  }

  /**
   * Generates the OAuth 1.0a authorization URL and stores the oauth_token_secret.
   */
  async getAuthorizationUrl(userId: string): Promise<string> {
    try {
      const callbackUrl = 'https://postingautomation.lfvs.in/api/v1/social-accounts/x/callback';

      const authLink = await this.client.generateAuthLink(callbackUrl, { linkMode: 'authorize' });

      // Store the oauth_token_secret mapped to the oauth_token in Redis with an expiry of 15 minutes (900s)
      await this.redis.set(
        `x_oauth:${authLink.oauth_token}`,
        JSON.stringify({ secret: authLink.oauth_token_secret, userId }),
        'EX',
        900
      );

      this.logger.log(`Generated X authorization URL for user: ${userId}`);
      return authLink.url;
    } catch (err: any) {
      this.logger.error('Failed to generate X authorization URL', err);
      throw new BadRequestException('Could not initiate X login flow. Ensure your callback URL and Consumer Secret are correct.');
    }
  }

  /**
   * Completes the OAuth 1.0a flow by exchanging the oauth_token and oauth_verifier
   * for permanent access tokens.
   */
  async exchangeTokens(
    oauthToken: string,
    oauthVerifier: string,
  ): Promise<{
    userId: string;
    accountId: string;
    accountName: string;
    accessToken: string;
    accessSecret: string;
  }> {
    const sessionDataStr = await this.redis.get(`x_oauth:${oauthToken}`);

    if (!sessionDataStr) {
      this.logger.warn(`No session found for oauth_token: ${oauthToken}`);
      throw new BadRequestException('OAuth session expired or invalid. Please try connecting again.');
    }

    const sessionData = JSON.parse(sessionDataStr);

    try {
      // 1. Create a client from the temporary token & secret
      const tempClient = new TwitterApi({
        appKey: this.configService.get<string>('x.consumerKey') || '',
        appSecret: this.configService.get<string>('x.consumerSecret') || '',
        accessToken: oauthToken,
        accessSecret: sessionData.secret,
      });

      // 2. Login to get the permanent user tokens
      const { client: loggedClient, accessToken, accessSecret, screenName, userId: xUserId } =
        await tempClient.login(oauthVerifier);

      this.logger.log(`Successfully completed OAuth flow for X user: ${screenName}`);

      // We no longer need the temporary secret
      await this.redis.del(`x_oauth:${oauthToken}`);

      return {
        userId: sessionData.userId,
        accountId: xUserId,
        accountName: screenName,
        accessToken,
        accessSecret,
      };
    } catch (err: any) {
      this.logger.error(`Failed to exchange X OAuth tokens`, err);
      throw new BadRequestException('Failed to exchange tokens with X. Please try again.');
    }
  }
}
