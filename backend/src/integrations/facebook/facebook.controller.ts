import { Controller, Get, Post, Body, Param, UseGuards, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FacebookService } from './facebook.service';
import { SocialAccountsService } from '../../modules/social-accounts/social-accounts.service';
import { SocialPlatform } from '../../modules/social-accounts/schemas/social-account.schema';

@Controller('api/v1/facebook')
@UseGuards(JwtAuthGuard)
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  private async getAccountData(userId: string) {
    const accounts = await this.socialAccountsService.getAccountsForPlatforms(userId, [SocialPlatform.FACEBOOK]);
    if (!accounts || accounts.length === 0) {
      throw new UnauthorizedException('No Facebook account connected');
    }
    return accounts[0];
  }

  @Get('comments/:accountId/:postId')
  async getComments(
    @CurrentUser('userId') userId: string,
    @Param('accountId') accountId: string,
    @Param('postId') postId: string,
  ) {
    const accountData = await this.getAccountData(userId);
    return this.facebookService.getComments(accountData.account.accountId, accountData.decryptedToken, postId);
  }

  @Post('reply/:accountId')
  async replyToComment(
    @CurrentUser('userId') userId: string,
    @Param('accountId') accountId: string,
    @Body() body: { targetId: string; message: string },
  ) {
    const accountData = await this.getAccountData(userId);
    return this.facebookService.replyToComment(accountData.account.accountId, accountData.decryptedToken, body.targetId, body.message);
  }
}
