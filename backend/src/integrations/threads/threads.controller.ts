import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ThreadsService } from './threads.service';
import { SocialAccountsService } from '../../modules/social-accounts/social-accounts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FirebaseAuthGuard } from '../../modules/auth/guards/firebase-auth.guard';
import { SocialPlatform } from '../../modules/social-accounts/schemas/social-account.schema';

@Controller('api/v1/threads')
@UseGuards(FirebaseAuthGuard)
export class ThreadsController {
  constructor(
    private readonly threadsService: ThreadsService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  private async getAccountData(userId: string) {
    const accounts = await this.socialAccountsService.getAccountsForPlatforms(userId, [SocialPlatform.THREADS]);
    if (!accounts || accounts.length === 0) {
      throw new BadRequestException('No Threads account connected');
    }
    return {
      accountId: accounts[0].account.accountId,
      accessToken: accounts[0].decryptedToken,
    };
  }

  @Get('mentions')
  async getMentions(@CurrentUser('userId') userId: string) {
    const { accountId, accessToken } = await this.getAccountData(userId);
    return this.threadsService.getMentions(accountId, accessToken);
  }

  @Get('recent-replies')
  async getRecentReplies(@CurrentUser('userId') userId: string) {
    const { accountId, accessToken } = await this.getAccountData(userId);
    
    // Fetch top 5 recent threads
    const postsResult = await this.threadsService.getAccountPosts(accountId, accessToken, 5);
    
    // Fetch replies for these threads in parallel
    let allReplies: any[] = [];
    const promises = postsResult.data.map(async (post) => {
      try {
        const replies = await this.threadsService.getReplies(post.id, accessToken);
        // attach context
        return replies.map(r => ({ 
          ...r, 
          originalPostId: post.id, 
          originalPostText: post.text 
        }));
      } catch (err) {
        return [];
      }
    });

    const results = await Promise.all(promises);
    results.forEach(arr => { allReplies = allReplies.concat(arr); });
    
    // Sort by newest
    allReplies.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return allReplies;
  }

  @Get('search')
  async searchThreads(
    @CurrentUser('userId') userId: string,
    @Query('query') query: string,
  ) {
    if (!query) throw new BadRequestException('Query parameter is required');
    const { accountId, accessToken } = await this.getAccountData(userId);
    return this.threadsService.searchThreads(accountId, accessToken, query);
  }

  @Get('profile-discovery')
  async discoverProfile(
    @CurrentUser('userId') userId: string,
    @Query('username') username: string,
  ) {
    if (!username) throw new BadRequestException('Username is required');
    const { accountId, accessToken } = await this.getAccountData(userId);
    return this.threadsService.getUserProfileDiscovery(accountId, accessToken, username);
  }

  @Get('posts/:postId/replies')
  async getReplies(
    @CurrentUser('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    const { accessToken } = await this.getAccountData(userId);
    return this.threadsService.getReplies(postId, accessToken);
  }

  @Post('posts/:postId/reply')
  async replyToPost(
    @CurrentUser('userId') userId: string,
    @Param('postId') postId: string,
    @Body('text') text: string,
  ) {
    if (!text) throw new BadRequestException('Text is required to reply');
    const { accountId, accessToken } = await this.getAccountData(userId);
    return this.threadsService.replyToThread(accountId, accessToken, postId, text);
  }

  @Post('replies/:replyId/hide')
  async hideReply(
    @CurrentUser('userId') userId: string,
    @Param('replyId') replyId: string,
    @Body('hide') hide: boolean,
  ) {
    const { accessToken } = await this.getAccountData(userId);
    return this.threadsService.hideReply(replyId, accessToken, hide ?? true);
  }

  @Delete('posts/:postId')
  async deleteThread(
    @CurrentUser('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    const { accessToken } = await this.getAccountData(userId);
    return this.threadsService.deleteThread(postId, accessToken);
  }
}
