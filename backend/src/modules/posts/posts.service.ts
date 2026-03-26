import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument, PostStatus, PostPlatform, PublishResult } from './schemas/post.schema';
import { CreatePostDto } from './dto/create-post.dto';
import { PostSchedulerService } from '../scheduler/services/post-scheduler.service';
import { SocialAccountsService } from '../social-accounts/social-accounts.service';
import { SocialPlatform } from '../social-accounts/schemas/social-account.schema';
import { FacebookService } from '../../integrations/facebook/facebook.service';
import { InstagramService } from '../../integrations/instagram/instagram.service';
import { ThreadsService } from '../../integrations/threads/threads.service';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private postSchedulerService: PostSchedulerService,
    private socialAccountsService: SocialAccountsService,
    private facebookService: FacebookService,
    private instagramService: InstagramService,
    private threadsService: ThreadsService,
  ) { }

  async create(userId: string, dto: CreatePostDto): Promise<PostDocument> {
    if (!dto.caption && (!dto.mediaUrls || dto.mediaUrls.length === 0)) {
      throw new BadRequestException(
        'A post must have either a caption or media attached',
      );
    }

    const isScheduled = !!dto.scheduledTime;

    if (isScheduled && new Date(dto.scheduledTime as string) <= new Date()) {
      throw new BadRequestException('scheduledTime must be in the future');
    }
    const initialStatus = PostStatus.PENDING;

    const post = new this.postModel({
      userId: new Types.ObjectId(userId),
      caption: dto.caption || '',
      mediaUrls: dto.mediaUrls || [],
      thumbnailUrl: dto.thumbnailUrl || null,
      platforms: dto.platforms,
      scheduledTime: dto.scheduledTime ? new Date(dto.scheduledTime) : null,
      location: dto.location || null,
      platformConfig: dto.platformConfig || null,
      status: initialStatus,
    });

    const savedPost = await post.save();

    // Enqueue the post for publishing
    try {
      if (isScheduled) {
        await this.postSchedulerService.schedulePost(
          savedPost._id.toString(),
          savedPost.scheduledTime,
        );
      } else {
        await this.postSchedulerService.publishPostNow(
          savedPost._id.toString(),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to schedule post ${savedPost._id}: ${error.message}`,
      );
      savedPost.status = PostStatus.FAILED;
      await savedPost.save();
    }

    return savedPost;
  }

  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.postModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.postModel.countDocuments({ userId: new Types.ObjectId(userId) }),
    ]);

    return {
      posts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(userId: string, postId: string): Promise<PostDocument> {
    const post = await this.postModel.findOne({
      _id: postId,
      userId: new Types.ObjectId(userId),
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post as PostDocument;
  }

  async updateStatus(
    postId: string,
    status: PostStatus,
    userId?: string,
  ): Promise<PostDocument> {
    const filter: any = { _id: postId };
    if (userId) {
      filter.userId = new Types.ObjectId(userId);
    }
    return this.postModel
      .findOneAndUpdate(filter, { status }, { new: true })
      .exec() as unknown as Promise<PostDocument>;
  }

  async remove(userId: string, postId: string): Promise<void> {
    const post = await this.findOne(userId, postId);

    if (
      post.status === PostStatus.PENDING ||
      post.status === PostStatus.PROCESSING
    ) {
      await this.postSchedulerService.cancelJob(post._id.toString());
    }

    await this.postModel.deleteOne({ _id: post._id });
  }

  /**
   * Delete all posts for a specific user and cancel any pending jobs.
   * Used during account deletion.
   */
  async deleteByUserId(userId: string): Promise<void> {
    const posts = await this.postModel.find({
      userId: new Types.ObjectId(userId),
      status: { $in: [PostStatus.PENDING, PostStatus.PROCESSING] },
    });

    // Cancel all pending jobs
    for (const post of posts) {
      try {
        await this.postSchedulerService.cancelJob(post._id.toString());
      } catch (error) {
        this.logger.warn(
          `Failed to cancel job for post ${post._id} during user deletion: ${error.message}`,
        );
      }
    }

    const result = await this.postModel.deleteMany({
      userId: new Types.ObjectId(userId),
    });
    this.logger.log(`Deleted ${result.deletedCount} posts for user ${userId}`);
  }

  async getPostAnalytics(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    if (!post.publishResults || post.publishResults.length === 0) {
      return post.analytics || [];
    }

    // Determine if we need to fetch fresh data
    // Use the oldest lastUpdated across all analytics entries for cache validity
    const lastUpdatedTimes = (post.analytics || [])
      .map((a) => a.lastUpdated)
      .filter(Boolean)
      .map((d) => new Date(d).getTime());
    const oldestLastUpdated = lastUpdatedTimes.length > 0
      ? Math.min(...lastUpdatedTimes)
      : null;
    const shouldFetchFresh = !oldestLastUpdated || (Date.now() - oldestLastUpdated > 3600000); // 1 hour cache

    if (!shouldFetchFresh) {
      return post.analytics;
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      post.platforms as unknown as SocialPlatform[],
    );

    const freshAnalytics: any[] = [];

    for (const result of post.publishResults) {
      if (!result.success || !result.platformPostId) continue;

      const accountItem = accountsWithTokens.find(
        (a) => (a.account.platform as string) === (result.platform as string),
      );

      if (!accountItem) continue;

      try {
        const stats = await this.fetchPlatformInsights(result.platform, accountItem, result.platformPostId);

        if (stats) {
          freshAnalytics.push({
            platform: result.platform,
            likes: stats.likes || 0,
            comments: stats.comments || 0,
            shares: stats.shares || 0,
            reach: stats.reach || 0,
            impressions: stats.impressions || 0,
            lastUpdated: new Date(),
          });
        }
      } catch (error) {
        this.logger.error(`Failed to fetch analytics for ${result.platform}: ${error.message}`);
      }
    }

    // Update cache
    if (freshAnalytics.length > 0) {
      post.analytics = freshAnalytics;
      await post.save();
      return freshAnalytics;
    }

    return post.analytics || [];
  }

  // #21: Generic platform analytics — replaces duplicated getFacebookAnalytics / getInstagramAnalytics / getThreadsAnalytics
  async getPlatformAnalytics(userId: string, postId: string, platform: PostPlatform) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    const platformResult = post.publishResults?.find(
      (r) => r.platform === platform && r.success && r.platformPostId,
    );
    if (!platformResult) {
      throw new BadRequestException(`${platform} post not found or not published successfully`);
    }

    const { accountItem } = await this.resolveAccount(userId, platform);
    const stats = await this.fetchPlatformInsights(platform, accountItem, platformResult.platformPostId as string);

    if (stats) {
      const analytics = {
        platform,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        reach: stats.reach || 0,
        impressions: stats.impressions || 0,
        lastUpdated: new Date(),
      };

      post.analytics = (post.analytics || []).filter((a) => a.platform !== platform);
      post.analytics.push(analytics);
      await post.save();
      return analytics;
    }

    return null;
  }

  // Backwards-compat wrappers
  async getFacebookAnalytics(userId: string, postId: string) {
    return this.getPlatformAnalytics(userId, postId, PostPlatform.FACEBOOK);
  }
  async getInstagramAnalytics(userId: string, postId: string) {
    return this.getPlatformAnalytics(userId, postId, PostPlatform.INSTAGRAM);
  }
  async getThreadsAnalytics(userId: string, postId: string) {
    return this.getPlatformAnalytics(userId, postId, PostPlatform.THREADS);
  }

  // #22: Generic platform post deletion — replaces duplicated deleteFacebookPost / deleteInstagramPost
  async deletePlatformPost(userId: string, postId: string, platform: PostPlatform) {
    const post = await this.findOne(userId, postId);

    // Find publish result — require platformPostId but not necessarily success=true
    // (handles partially-failed posts that still have a platform post ID)
    const platformResult = post.publishResults?.find(
      (r) => (r.platform as string) === (platform as string) && r.platformPostId,
    );
    if (!platformResult) {
      throw new BadRequestException(
        `No ${platform} post ID found. The post may not have been published to ${platform}.`,
      );
    }

    const { accountItem } = await this.resolveAccount(userId, platform);

    // Execute platform-specific delete (Instagram API may not support it — graceful)
    if (platform === PostPlatform.FACEBOOK) {
      await this.facebookService.deletePost(
        accountItem.account.accountId,
        accountItem.decryptedToken,
        platformResult.platformPostId as string,
      );
    } else if (platform === PostPlatform.INSTAGRAM) {
      // Instagram Graph API does not support post deletion — returns false, not an error
      const deleted = await this.instagramService.deleteMedia(
        accountItem.account.accountId,
        accountItem.decryptedToken,
        platformResult.platformPostId as string,
      );
      if (!deleted) {
        this.logger.warn(`Instagram API deletion not supported; marking locally deleted only.`);
      }
    } else if (platform === PostPlatform.THREADS) {
      await this.threadsService.deleteThread(
        platformResult.platformPostId as string,
        accountItem.decryptedToken,
      );
    }

    // Mark the platform as deleted in the DB regardless of API support
    const resultIndex = post.publishResults.findIndex(
      (r) => (r.platform as string) === (platform as string),
    );
    if (resultIndex > -1) {
      post.publishResults[resultIndex].success = false;
      post.publishResults[resultIndex].error = 'Post deleted from platform';
      post.markModified('publishResults');
      await post.save();
    }

    return { success: true, message: `${platform} post removed successfully` };
  }


  // Backwards-compat wrappers
  async deleteFacebookPost(userId: string, postId: string) {
    return this.deletePlatformPost(userId, postId, PostPlatform.FACEBOOK);
  }
  async deleteInstagramPost(userId: string, postId: string) {
    return this.deletePlatformPost(userId, postId, PostPlatform.INSTAGRAM);
  }
  async deleteThreadsPost(userId: string, postId: string) {
    return this.deletePlatformPost(userId, postId, PostPlatform.THREADS);
  }

  // --- Private helpers ---

  private async resolveAccount(userId: string, platform: PostPlatform) {
    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [platform as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as string) === (platform as string),
    );

    if (!accountItem) {
      throw new BadRequestException(`Linked ${platform} account not found`);
    }

    return { accountItem };
  }

  private async fetchPlatformInsights(platform: PostPlatform, accountItem: any, platformPostId: string) {
    if (platform === PostPlatform.FACEBOOK) {
      return this.facebookService.getPostInsights(
        accountItem.account.accountId,
        accountItem.decryptedToken,
        platformPostId,
      );
    } else if (platform === PostPlatform.INSTAGRAM) {
      return this.instagramService.getPostInsights(
        accountItem.account.accountId,
        accountItem.decryptedToken,
        platformPostId,
      );
    } else if (platform === PostPlatform.THREADS) {
      return this.threadsService.getPostInsights(
        accountItem.account.accountId,
        accountItem.decryptedToken,
        platformPostId,
      );
    }
    return null;
  }

  async getPlatformPosts(
    userId: string,
    accountId: string,
    limit: number = 10,
    cursor?: string,
  ) {
    const allTokens = await this.socialAccountsService.getAccountsForPlatforms(userId, [
      SocialPlatform.FACEBOOK,
      SocialPlatform.INSTAGRAM,
      SocialPlatform.THREADS,
    ]);

    const targetAccount = allTokens.find(a => a.account._id.toString() === accountId);
    if (!targetAccount) {
      throw new NotFoundException('Social account not found or unsupported platform');
    }

    const platform = targetAccount.account.platform;
    const decryptedToken = targetAccount.decryptedToken;
    const platformAccountId = targetAccount.account.accountId;

    // We can confidently assert these are supported due to the platforms array above
    if (platform === SocialPlatform.FACEBOOK) {
      const fbService = this.facebookService as any;
      return fbService.getAccountPosts(platformAccountId, decryptedToken, limit, cursor);
    } else if (platform === SocialPlatform.INSTAGRAM) {
      const igService = this.instagramService as any;
      return igService.getAccountPosts(platformAccountId, decryptedToken, limit, cursor);
    } else if (platform === SocialPlatform.THREADS) {
      const thService = this.threadsService as any;
      return thService.getAccountPosts(platformAccountId, decryptedToken, limit, cursor);
    }

    throw new BadRequestException('Platform history not supported');
  }

  async getPlatformPostAnalytics(userId: string, accountId: string, platformPostId: string) {
    const allTokens = await this.socialAccountsService.getAccountsForPlatforms(userId, [
      SocialPlatform.FACEBOOK,
      SocialPlatform.INSTAGRAM,
      SocialPlatform.THREADS,
    ]);

    const targetAccount = allTokens.find(a => a.account._id.toString() === accountId);
    if (!targetAccount) {
      throw new NotFoundException('Social account not found or unsupported platform');
    }

    const { platform } = targetAccount.account;

    // Use the existing method to fetch the raw analytics from the integration
    const stats = await this.fetchPlatformInsights(
      platform as unknown as PostPlatform,
      targetAccount,
      platformPostId
    );

    if (!stats) {
      throw new BadRequestException('Could not fetch advanced analytics for this post');
    }

    return {
      platform,
      platformPostId,
      likes: stats.likes || 0,
      comments: stats.comments || 0,
      shares: stats.shares || 0,
      reach: stats.reach || 0,
      impressions: stats.impressions || 0,
      lastUpdated: new Date()
    };
  }
}
