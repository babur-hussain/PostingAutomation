import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  Post,
  PostDocument,
  PostStatus,
  PostPlatform,
} from '../../posts/schemas/post.schema';
import { SocialAccountsService } from '../../social-accounts/social-accounts.service';
import { SocialPlatform } from '../../social-accounts/schemas/social-account.schema';
import { InstagramService } from '../../../integrations/instagram/instagram.service';
import { FacebookService } from '../../../integrations/facebook/facebook.service';
import { YouTubeService } from '../../../integrations/youtube/youtube.service';
import { XService } from '../../../integrations/x/x.service';
import { ThreadsService } from '../../../integrations/threads/threads.service';

@Processor('posts', { concurrency: 5 })
export class QueueWorker extends WorkerHost {
  private readonly logger = new Logger(QueueWorker.name);

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private socialAccountsService: SocialAccountsService,
    private instagramService: InstagramService,
    private facebookService: FacebookService,
    private youtubeService: YouTubeService,
    private xService: XService,
    private threadsService: ThreadsService,
    private configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<{ postId: string }, any, string>): Promise<any> {
    const { postId } = job.data;
    this.logger.log(`Processing job ${job.id} for post ${postId}`);

    const post = await this.postModel.findById(postId);
    if (!post) {
      this.logger.warn(`Post ${postId} not found`);
      return;
    }

    if (
      post.status !== PostStatus.PENDING &&
      post.status !== PostStatus.PROCESSING
    ) {
      this.logger.warn(`Post ${postId} is in status ${post.status}. Skipping.`);
      return;
    }

    // Mark as processing
    post.status = PostStatus.PROCESSING;
    await post.save();

    try {
      const accountsWithTokens =
        await this.socialAccountsService.getAccountsForPlatforms(
          post.userId.toString(),
          post.platforms as unknown as SocialPlatform[],
        );

      if (accountsWithTokens.length === 0) {
        throw new Error('No social accounts found for the specified platforms');
      }

      const results: any[] = [];

      for (const accountItem of accountsWithTokens) {
        const { account, decryptedToken } = accountItem;
        let success = false;
        let platformId: string | null = null;
        let errorMsg: string | null = null;

        try {
          if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.INSTAGRAM
          ) {
            platformId = await this.instagramService.publishInstagramPost(
              account.accountId,
              decryptedToken,
              post.mediaUrl,
              post.caption,
              post.location,
            );
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.FACEBOOK
          ) {
            platformId = await this.facebookService.publishFacebookPost(
              account.accountId,
              decryptedToken,
              post.caption,
              post.mediaUrl,
              post.location,
            );
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.YOUTUBE
          ) {
            // Only publish if there is a mediaUrl (video)
            if (post.mediaUrl) {
              const youtubeTitle = post.caption
                ? post.caption.substring(0, 100)
                : 'Untitled Video';
              platformId = await this.youtubeService.publishYouTubeVideo(
                decryptedToken,
                post.mediaUrl,
                youtubeTitle,
                post.caption, // full caption as description
                post.location,
              );
              success = true;
            } else {
              throw new Error('A video is required to post to YouTube');
            }
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.X
          ) {
            const appKey = this.configService.get<string>('x.consumerKey');
            const appSecret = this.configService.get<string>('x.consumerSecret');

            if (!appKey || !appSecret) {
              throw new Error('X API Consumer Key and Secret are not configured.');
            }

            platformId = await this.xService.publishTweet(
              appKey,
              appSecret,
              decryptedToken,
              accountItem.decryptedSecret || '', // Must be returned from getAccountsForPlatforms overlay
              post.caption,
              post.mediaUrl,
              post.location,
            );
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.THREADS
          ) {
            platformId = await this.threadsService.publishThreadsPost(
              account.accountId,
              decryptedToken,
              post.caption,
              post.mediaUrl,
              post.location,
            );
            success = true;
          }
        } catch (error) {
          success = false;
          errorMsg = error.message;
          this.logger.error(
            `Failed to publish post ${postId} to ${account.platform}: ${error.message}`,
          );
        }

        results.push({
          platform: account.platform,
          success,
          platformPostId: platformId,
          error: errorMsg,
          publishedAt: success ? new Date() : undefined,
        });
      }

      const allSuccess = results.every((r) => r.success);
      const anySuccess = results.some((r) => r.success);

      if (allSuccess) {
        post.status = PostStatus.PUBLISHED;
      } else if (anySuccess) {
        post.status = PostStatus.PARTIALLY_PUBLISHED;
      } else {
        post.status = PostStatus.FAILED;
      }
      post.publishResults = results;
      post.markModified('publishResults');
      await post.save();

      return { results };
    } catch (error) {
      this.logger.error(`Failed to process post ${postId}: ${error.message}`);
      post.status = PostStatus.FAILED;
      await post.save();
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} has completed!`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed with error ${error.message}`);
  }
}
