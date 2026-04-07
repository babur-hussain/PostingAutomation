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
import { MediaService } from '../../media/media.service';

@Processor('posts', { concurrency: 3 })
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
    private mediaService: MediaService,
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

      // Pre-sign S3 URLs so Meta and other platforms don't receive AccessDenied (XML) instead of media
      const presignedMediaUrls: string[] = [];
      if (post.mediaUrls && post.mediaUrls.length > 0) {
        for (const url of post.mediaUrls) {
          if (url.includes('.amazonaws.com/')) {
            const key = url.split('.amazonaws.com/')[1];
            if (key) {
              try {
                presignedMediaUrls.push(await this.mediaService.getPresignedUrl(key));
                continue;
              } catch (e) {
                this.logger.warn(`Failed to presign URL for ${key}: ${e.message}`);
              }
            }
          }
          presignedMediaUrls.push(url); // Fallback to raw url
        }
      }

      const results: any[] = [];

      // Helper: build per-platform caption with mentions & hashtags appended
      const buildCaption = (platform: string, baseCaption: string): string => {
        const pc = (post as any).platformConfig?.[platform];
        if (!pc) return baseCaption;
        let enriched = baseCaption;
        if (pc.mentions?.length) {
          enriched += '\n' + pc.mentions.map((m: string) => `@${m}`).join(' ');
        }
        if (pc.hashtags?.length) {
          enriched += '\n' + pc.hashtags.map((h: string) => `#${h}`).join(' ');
        }
        return enriched;
      };

      // Helper: get per-platform location, falling back to shared location
      const getLocation = (platform: string) => {
        return (post as any).platformConfig?.[platform]?.location || post.location;
      };

      for (const accountItem of accountsWithTokens) {
        const { account, decryptedToken } = accountItem;
        let success = false;
        let platformId: string | null = null;
        let permalink: string | null = null;
        let errorMsg: string | null = null;

        try {
          if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.INSTAGRAM
          ) {
            const igMediaUrl = presignedMediaUrls.length > 0 ? presignedMediaUrls[0] : null;
            const res = await this.instagramService.publishInstagramPost(
              account.accountId,
              decryptedToken,
              igMediaUrl || '',
              buildCaption('instagram', post.caption),
              getLocation('instagram'),
            );
            platformId = res.id;
            permalink = res.permalink;
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.FACEBOOK
          ) {
            const fbMediaUrl = presignedMediaUrls.length > 0 ? presignedMediaUrls[0] : null;
            const res = await this.facebookService.publishFacebookPost(
              account.accountId,
              decryptedToken,
              buildCaption('facebook', post.caption),
              fbMediaUrl || '',
              getLocation('facebook'),
            );
            platformId = res.id;
            permalink = res.permalink;
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.YOUTUBE
          ) {
            // Only publish if there is a mediaUrl (video)
            const ytMediaUrl = presignedMediaUrls.length > 0 ? presignedMediaUrls[0] : null;
            if (ytMediaUrl) {
              const ytCaption = buildCaption('youtube', post.caption);
              const youtubeTitle = ytCaption
                ? ytCaption.substring(0, 100)
                : 'Untitled Video';
              platformId = await this.youtubeService.publishYouTubeVideo(
                decryptedToken,
                ytMediaUrl,
                youtubeTitle,
                ytCaption, // full caption as description
                getLocation('youtube'),
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

            const xMediaUrl = presignedMediaUrls.length > 0 ? presignedMediaUrls[0] : null;
            platformId = await this.xService.publishTweet(
              appKey,
              appSecret,
              decryptedToken,
              accountItem.decryptedSecret || '',
              buildCaption('x', post.caption),
              xMediaUrl || '',
              getLocation('x'),
            );
            success = true;
          } else if (
            (account.platform as unknown as PostPlatform) ===
            PostPlatform.THREADS
          ) {
            const thMediaUrl = presignedMediaUrls.length > 0 ? presignedMediaUrls[0] : null;
            const res = await this.threadsService.publishThreadsPost(
              account.accountId,
              decryptedToken,
              buildCaption('threads', post.caption),
              thMediaUrl || '',
              getLocation('threads'),
            );
            platformId = res.id;
            permalink = res.permalink;
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
          permalink,
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
