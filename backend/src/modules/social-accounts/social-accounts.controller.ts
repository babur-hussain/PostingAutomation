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
    this.logger.log(`Received Threads Deauthorize Webhook: ${JSON.stringify(body)}`);
    // In a production app, verify the signature using app secret
    // Parse the signed_request to get user_id and remove their account
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
}
