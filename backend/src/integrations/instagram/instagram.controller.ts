import { Controller, Get, Post, Body, Param, UseGuards, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InstagramService } from './instagram.service';
import { SocialAccountsService } from '../../modules/social-accounts/social-accounts.service';
import { SocialPlatform } from '../../modules/social-accounts/schemas/social-account.schema';

@Controller('api/v1/instagram')
@UseGuards(JwtAuthGuard)
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  private async getAccountData(userId: string) {
    const accounts = await this.socialAccountsService.getAccountsForPlatforms(userId, [SocialPlatform.INSTAGRAM]);
    if (!accounts || accounts.length === 0) {
      throw new UnauthorizedException('No Instagram account connected');
    }
    return accounts[0];
  }

  @Get('comments/:accountId/:mediaId')
  async getComments(
    @CurrentUser('userId') userId: string,
    @Param('accountId') accountId: string,
    @Param('mediaId') mediaId: string,
  ) {
    const accountData = await this.getAccountData(userId);
    return this.instagramService.getComments(accountData.account.accountId, accountData.decryptedToken, mediaId);
  }

  @Post('reply/:accountId')
  async replyToComment(
    @CurrentUser('userId') userId: string,
    @Param('accountId') accountId: string,
    @Body() body: { targetId: string; message: string },
  ) {
    const accountData = await this.getAccountData(userId);
    return this.instagramService.replyToComment(accountData.account.accountId, accountData.decryptedToken, body.targetId, body.message);
  }
}
