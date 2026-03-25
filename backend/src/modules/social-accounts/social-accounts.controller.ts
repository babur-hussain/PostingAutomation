import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SocialAccountsService } from './social-accounts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SocialPlatform } from './schemas/social-account.schema';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

@Controller('api/v1/social-accounts')
export class SocialAccountsController {
  private readonly logger = new Logger(SocialAccountsController.name);

  constructor(
    private socialAccountsService: SocialAccountsService,
    private configService: ConfigService,
  ) { }

  /**
   * Returns the Meta OAuth authorization URL as JSON.
   * The mobile app calls this with a Bearer token (via Axios),
   * then opens the returned URL in an InAppBrowser.
   */
  @UseGuards(FirebaseAuthGuard)
  @Get(':platform/auth-url')
  async getAuthUrl(
    @Param('platform') platform: SocialPlatform,
    @CurrentUser('userId') userId: string,
  ) {
    const url = await this.socialAccountsService.getConnectUrl(platform, userId);
    return { url };
  }

  /**
   * Meta OAuth callback — handles both Instagram and Facebook.
   * This is called by Meta's servers after the user authorizes.
   * No auth guard needed — the user identity comes from the state param.
   */
  @Get('meta/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    // Handle user-cancelled OAuth
    if (error) {
      this.logger.warn(`OAuth error: ${error} - ${errorDescription}`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(errorDescription || 'Authorization was cancelled')}`,
      );
    }

    try {
      // #3: Verify HMAC-signed state to prevent CSRF
      this.socialAccountsService.verifyState(state);

      const result = await this.socialAccountsService.handleCallback(
        code,
        state,
      );
      return res.redirect(
        `postingautomation://social-auth-callback?success=true&platform=${result.platform}&account=${encodeURIComponent(result.accountName)}`,
      );
    } catch (err) {
      this.logger.error('OAuth callback error', err);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  /**
   * Facebook OAuth callback.
   * Completely decoupled from the instagram flow.
   */
  @Get('facebook/callback')
  async facebookCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`Facebook OAuth error: ${error} - ${errorDescription}`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(errorDescription || 'Authorization was cancelled')}`,
      );
    }

    try {
      const result = await this.socialAccountsService.handleFacebookCallback(
        code,
        state,
      );
      return res.redirect(
        `postingautomation://social-auth-callback?success=true&platform=${result.platform}&account=${encodeURIComponent(result.accountName)}`,
      );
    } catch (err) {
      this.logger.error('Facebook OAuth callback error', err);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  /**
   * Threads OAuth callback.
   * Completely decoupled from the meta flow.
   */
  @Get('threads/callback')
  async threadsCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`Threads OAuth error: ${error} - ${errorDescription}`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(errorDescription || 'Authorization was cancelled')}`,
      );
    }

    try {
      const result = await this.socialAccountsService.handleThreadsCallback(
        code,
        state,
      );
      return res.redirect(
        `postingautomation://social-auth-callback?success=true&platform=${result.platform}&account=${encodeURIComponent(result.accountName)}`,
      );
    } catch (err) {
      this.logger.error('Threads OAuth callback error', err);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  /**
   * Threads Uninstall Callback URL.
   * Called by Meta when a user uninstalls the app or removes permissions.
   */
  @Post('threads/deauthorize')
  @HttpCode(HttpStatus.OK)
  async threadsDeauthorize(@Body() body: any) {
    this.logger.log(`Received Threads Deauthorize Webhook`);

    // #5: Verify the signed_request from Meta
    const signedRequest = body?.signed_request;
    if (signedRequest) {
      try {
        const appSecret = this.configService.get<string>('threads.appSecret') || this.configService.get<string>('meta.appSecret');
        if (appSecret) {
          const [encodedSig, payload] = signedRequest.split('.', 2);
          const crypto = require('crypto');
          const expectedSig = crypto
            .createHmac('sha256', appSecret)
            .update(payload)
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
          if (encodedSig !== expectedSig) {
            this.logger.warn('Invalid signed_request signature on Threads deauthorize webhook');
            return { success: false, error: 'Invalid signature' };
          }
        } else {
          this.logger.warn('No app secret configured — skipping webhook signature verification');
        }
      } catch (err) {
        this.logger.error('Failed to verify Threads deauthorize webhook signature', err);
        return { success: false, error: 'Signature verification failed' };
      }
    } else {
      this.logger.warn('No signed_request present in Threads deauthorize webhook body');
    }

    return { success: true };
  }

  /**
   * Threads Delete Callback URL.
   * Called by Meta when a user requests their data be deleted.
   */
  @Post('threads/delete-data')
  @HttpCode(HttpStatus.OK)
  async threadsDeleteData(@Body() body: any) {
    this.logger.log(`Received Threads Delete Data Webhook: ${JSON.stringify(body)}`);
    // Parse the signed_request to get user_id and remove their data

    // Meta requires returning a JSON object with a url where the user can check the status 
    // and a confirmation code.
    return {
      url: `${this.configService.get('frontendUrl')}/data-deletion-status`,
      confirmation_code: `del-${Date.now()}`
    };
  }

  /**
   * YouTube OAuth callback.
   * This is called by Google's servers after the user authorizes.
   */
  @Get('youtube/callback')
  async youtubeCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`YouTube OAuth error: ${error}`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent('Authorization was cancelled')}`,
      );
    }

    try {
      if (!state) {
        throw new Error('Missing state parameter from OAuth callback');
      }
      const result = await this.socialAccountsService.handleCallback(
        code,
        state,
      );
      return res.redirect(
        `postingautomation://social-auth-callback?success=true&platform=${result.platform}&account=${encodeURIComponent(result.accountName)}`,
      );
    } catch (err) {
      this.logger.error('YouTube OAuth callback error', err);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  /**
   * X (Twitter) OAuth callback.
   * This is called by X's servers after the user authorizes via OAuth 1.0a.
   */
  @Get('x/callback')
  async xCallback(
    @Query('oauth_token') oauthToken: string,
    @Query('oauth_verifier') oauthVerifier: string,
    @Query('denied') denied: string,
    @Res() res: Response,
  ) {
    if (denied) {
      this.logger.warn(`X OAuth denied by user: ${denied}`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent('Authorization was cancelled')}`,
      );
    }

    if (!oauthToken || !oauthVerifier) {
      this.logger.warn(`X OAuth missing tokens in callback`);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent('Missing OAuth tokens from X')}`,
      );
    }

    try {
      const result = await this.socialAccountsService.handleXCallback(
        oauthToken,
        oauthVerifier,
      );
      return res.redirect(
        `postingautomation://social-auth-callback?success=true&platform=${result.platform}&account=${encodeURIComponent(result.accountName)}`,
      );
    } catch (err: any) {
      this.logger.error('X OAuth callback error', err);
      return res.redirect(
        `postingautomation://social-auth-callback?success=false&message=${encodeURIComponent(err.message)}`,
      );
    }
  }

  /**
   * Get all connected social accounts.
   */
  @UseGuards(FirebaseAuthGuard)
  @Get()
  async getAccounts(@CurrentUser('userId') userId: string) {
    return this.socialAccountsService.getAccounts(userId);
  }

  /**
   * Get analytics for a specific connected social account.
   */
  @UseGuards(FirebaseAuthGuard)
  @Get(':id/analytics')
  async getAccountAnalytics(
    @CurrentUser('userId') userId: string,
    @Param('id') accountId: string,
  ) {
    return this.socialAccountsService.getAccountAnalytics(userId, accountId);
  }

  /**
   * Disconnect a social account.
   */
  @UseGuards(FirebaseAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async disconnect(
    @CurrentUser('userId') userId: string,
    @Param('id') accountId: string,
  ) {
    await this.socialAccountsService.disconnectAccount(userId, accountId);
    return { message: 'Account disconnected successfully' };
  }

  /**
   * Manually connect an Instagram or X account using a raw access token.
   * For testing / App review — bypasses the OAuth flow.
   */
  @UseGuards(FirebaseAuthGuard)
  @Post('connect-token')
  async connectWithToken(
    @CurrentUser('userId') userId: string,
    @Body('platform') platform: SocialPlatform,
    @Body('accessToken') accessToken: string,
  ) {
    // #4: Gate behind non-production environment
    const nodeEnv = this.configService.get<string>('nodeEnv');
    if (nodeEnv === 'production') {
      throw new BadRequestException(
        'Manual token connection is disabled in production',
      );
    }

    this.logger.log(
      `[ManualConnect] Manual token connection for platform: ${platform}`,
    );

    const result = await this.socialAccountsService.connectWithToken(
      userId,
      platform,
      accessToken,
    );

    return { message: 'Account connected successfully', ...result };
  }

  /**
   * Search for users/pages on a platform to enable @mention autocomplete.
   * Uses Instagram Business Discovery and Facebook Page Search where available.
   */
  @Get('search-users')
  @UseGuards(FirebaseAuthGuard)
  async searchUsers(
    @CurrentUser('userId') userId: string,
    @Query('platform') platform: string,
    @Query('q') query: string,
  ) {
    if (!query || query.length < 2) {
      return { results: [] };
    }

    try {
      // Get the user's account + decrypted token for this platform
      const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
        userId,
        [platform as any],
      );
      if (accountsWithTokens.length === 0) {
        return { results: [] };
      }

      const { account, decryptedToken } = accountsWithTokens[0];
      const results: any[] = [];
      const axios = (await import('axios')).default;

      if (platform === 'instagram') {
        // Instagram Business Discovery API — exact username lookup
        // Docs: GET /{ig-user-id}?fields=business_discovery.fields(...){@username}
        try {
          this.logger.log(`[SearchUsers] Instagram BD lookup for: ${query}`);
          const bdResponse = await axios.get(
            `https://graph.facebook.com/v25.0/${account.accountId}`,
            {
              params: {
                fields: `business_discovery.fields(username,name,profile_picture_url,followers_count){@${query}}`,
                access_token: decryptedToken,
              },
            },
          );
          const bd = bdResponse.data?.business_discovery;
          this.logger.log(`[SearchUsers] Instagram BD result: ${JSON.stringify(bd)}`);
          if (bd) {
            results.push({
              username: bd.username,
              name: bd.name || bd.username,
              profilePicture: bd.profile_picture_url,
              platform: 'instagram',
            });
          }
        } catch (err: any) {
          this.logger.warn(`[SearchUsers] Instagram BD failed for "${query}": ${err?.response?.data?.error?.message || err.message}`);
        }
      } else if (platform === 'facebook') {
        // Facebook Page Search API
        try {
          this.logger.log(`[SearchUsers] Facebook page search for: ${query}`);
          const fbResponse = await axios.get(
            `https://graph.facebook.com/v25.0/pages/search`,
            {
              params: {
                q: query,
                fields: 'id,name,picture,username',
                access_token: decryptedToken,
                limit: 10,
              },
            },
          );
          const pages = fbResponse.data?.data || [];
          this.logger.log(`[SearchUsers] Facebook found ${pages.length} pages`);
          for (const page of pages) {
            results.push({
              username: page.username || page.name,
              name: page.name,
              profilePicture: page.picture?.data?.url,
              platform: 'facebook',
              pageId: page.id,
            });
          }
        } catch (err: any) {
          this.logger.warn(`[SearchUsers] Facebook search failed: ${err?.response?.data?.error?.message || err.message}`);
        }
      } else if (platform === 'threads') {
        // Threads API does not support user search.
        // However, Threads usernames mirror Instagram usernames.
        // We can find the user's connected Instagram account and use its token for Business Discovery.
        try {
          this.logger.log(`[SearchUsers] Threads: attempting Instagram BD fallback for query="${query}"`);
          const igAccounts = await this.socialAccountsService.getAccountsForPlatforms(userId, ['instagram' as any]);
          if (igAccounts && igAccounts.length > 0) {
            const igAccount = igAccounts[0].account;
            const igToken = igAccounts[0].decryptedToken;

            const bdResponse = await axios.get(
              `https://graph.facebook.com/v25.0/${igAccount.accountId}`,
              {
                params: {
                  fields: `business_discovery.fields(username,name,profile_picture_url){@${query}}`,
                  access_token: igToken,
                },
              },
            );
            const bd = bdResponse.data?.business_discovery;
            if (bd) {
              results.push({
                username: bd.username,
                name: bd.name || bd.username,
                profilePicture: bd.profile_picture_url, // This is the IG pic, but usually the same as Threads
                platform: 'threads',
              });
            }
          } else {
            this.logger.log(`[SearchUsers] Threads: No connected Instagram account found to perform fallback lookup.`);
          }
        } catch (err: any) {
          this.logger.warn(`[SearchUsers] Threads Instagram fallback failed for "${query}": ${err?.response?.data?.error?.message || err.message}`);
        }
      } else if (platform === 'x') {
        this.logger.log(`[SearchUsers] X: no search API available for user lookup`);
      }

      this.logger.log(`[SearchUsers] Returning ${results.length} results for platform=${platform}, q=${query}`);
      return { results };
    } catch (error: any) {
      this.logger.error(`User search failed: ${error.message}`);
      return { results: [] };
    }
  }
}
