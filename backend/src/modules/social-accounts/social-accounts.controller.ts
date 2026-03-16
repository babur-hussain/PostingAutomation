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
    const url = this.socialAccountsService.getConnectUrl(platform, userId);
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
    @Body('accessSecret') accessSecret?: string,
  ) {
    this.logger.log(
      `[ManualConnect] Manual token connection for platform: ${platform}`,
    );

    let result;
    if (platform === SocialPlatform.X) {
      if (!accessSecret) {
        throw new BadRequestException('accessSecret is required for X Manual Connection (OAuth 1.0a implies a secret)');
      }
      result = await this.socialAccountsService.connectXWithToken(
        userId,
        accessToken,
        accessSecret,
      );
    } else {
      result = await this.socialAccountsService.connectWithToken(
        userId,
        platform,
        accessToken,
      );
    }

    return { message: 'Account connected successfully', ...result };
  }
}
