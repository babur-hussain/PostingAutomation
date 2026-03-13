import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
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
  ) {}

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
      const result = await this.socialAccountsService.handleCallback(code, state);
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
}
