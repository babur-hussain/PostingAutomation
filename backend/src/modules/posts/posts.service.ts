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
    if (!dto.caption && !dto.mediaUrl) {
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
      mediaUrl: dto.mediaUrl || null,
      platforms: dto.platforms,
      scheduledTime: dto.scheduledTime ? new Date(dto.scheduledTime) : null,
      location: dto.location || null,
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
  ): Promise<PostDocument> {
    return this.postModel
      .findByIdAndUpdate(postId, { status }, { new: true })
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

  async getPostAnalytics(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    if (!post.publishResults || post.publishResults.length === 0) {
      return post.analytics || [];
    }

    // Determine if we need to fetch fresh data
    const lastUpdated = post.analytics?.[0]?.lastUpdated;
    const shouldFetchFresh = !lastUpdated || (Date.now() - new Date(lastUpdated).getTime() > 3600000); // 1 hour cache

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
        (a) => (a.account.platform as unknown as string) === (result.platform as unknown as string),
      );

      if (!accountItem) continue;

      try {
        let stats: any = null;

        if (result.platform === PostPlatform.FACEBOOK) {
          stats = await this.facebookService.getPostInsights(
            accountItem.account.accountId,
            accountItem.decryptedToken,
            result.platformPostId,
          );
        } else if (result.platform === PostPlatform.INSTAGRAM) {
          stats = await this.instagramService.getPostInsights(
            accountItem.account.accountId,
            accountItem.decryptedToken,
            result.platformPostId,
            accountItem.decryptedToken.startsWith('IG'),
          );
        } else if (result.platform === PostPlatform.THREADS) {
          stats = await this.threadsService.getPostInsights(
            accountItem.account.accountId,
            accountItem.decryptedToken,
            result.platformPostId,
          );
        }

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

  async getFacebookAnalytics(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    const fbResult = post.publishResults?.find((r) => r.platform === PostPlatform.FACEBOOK && r.success && r.platformPostId);
    if (!fbResult) {
      throw new BadRequestException('Facebook post not found or not published successfully');
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [PostPlatform.FACEBOOK as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as unknown as string) === (PostPlatform.FACEBOOK as unknown as string),
    );

    if (!accountItem) {
      throw new BadRequestException('Linked Facebook account not found');
    }

    const stats = await this.facebookService.getPostInsights(
      accountItem.account.accountId,
      accountItem.decryptedToken,
      fbResult.platformPostId as string,
    );

    if (stats) {
      const fbAnalytics = {
        platform: PostPlatform.FACEBOOK,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        reach: stats.reach || 0,
        impressions: stats.impressions || 0,
        lastUpdated: new Date(),
      };

      post.analytics = (post.analytics || []).filter((a) => a.platform !== PostPlatform.FACEBOOK);
      post.analytics.push(fbAnalytics);
      await post.save();
      return fbAnalytics;
    }

    return null;
  }

  async getInstagramAnalytics(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    const igResult = post.publishResults?.find((r) => r.platform === PostPlatform.INSTAGRAM && r.success && r.platformPostId);
    if (!igResult) {
      throw new BadRequestException('Instagram post not found or not published successfully');
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [PostPlatform.INSTAGRAM as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as unknown as string) === (PostPlatform.INSTAGRAM as unknown as string),
    );

    if (!accountItem) {
      throw new BadRequestException('Linked Instagram account not found');
    }

    const stats = await this.instagramService.getPostInsights(
      accountItem.account.accountId,
      accountItem.decryptedToken,
      igResult.platformPostId as string,
      accountItem.decryptedToken.startsWith('IG'),
    );

    if (stats) {
      const igAnalytics = {
        platform: PostPlatform.INSTAGRAM,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        reach: stats.reach || 0,
        impressions: stats.impressions || 0,
        lastUpdated: new Date(),
      };

      post.analytics = (post.analytics || []).filter((a) => a.platform !== PostPlatform.INSTAGRAM);
      post.analytics.push(igAnalytics);
      await post.save();
      return igAnalytics;
    }

    return null;
  }

  async getThreadsAnalytics(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    if (post.status !== PostStatus.PUBLISHED) {
      throw new BadRequestException('Can only fetch analytics for published posts');
    }

    const threadsResult = post.publishResults?.find((r) => r.platform === PostPlatform.THREADS && r.success && r.platformPostId);
    if (!threadsResult) {
      throw new BadRequestException('Threads post not found or not published successfully');
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [PostPlatform.THREADS as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as unknown as string) === (PostPlatform.THREADS as unknown as string),
    );

    if (!accountItem) {
      throw new BadRequestException('Linked Threads account not found');
    }

    const stats = await this.threadsService.getPostInsights(
      accountItem.account.accountId,
      accountItem.decryptedToken,
      threadsResult.platformPostId as string,
    );

    if (stats) {
      const threadsAnalytics = {
        platform: PostPlatform.THREADS,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        reach: stats.reach || 0,
        impressions: stats.impressions || 0,
        lastUpdated: new Date(),
      };

      post.analytics = (post.analytics || []).filter((a) => a.platform !== PostPlatform.THREADS);
      post.analytics.push(threadsAnalytics);
      await post.save();
      return threadsAnalytics;
    }

    return null;
  }

  async deleteFacebookPost(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    const fbResult = post.publishResults?.find((r) => r.platform === PostPlatform.FACEBOOK && r.success && r.platformPostId);
    if (!fbResult) {
      throw new BadRequestException('Facebook post not found or not published successfully');
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [PostPlatform.FACEBOOK as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as unknown as string) === (PostPlatform.FACEBOOK as unknown as string),
    );

    if (!accountItem) {
      throw new BadRequestException('Linked Facebook account not found');
    }

    await this.facebookService.deletePost(
      accountItem.account.accountId,
      accountItem.decryptedToken,
      fbResult.platformPostId as string,
    );

    // Optionally mark the platform as deleted in the DB
    const resultIndex = post.publishResults.findIndex((r) => r.platform === PostPlatform.FACEBOOK);
    if (resultIndex > -1) {
      post.publishResults[resultIndex].success = false;
      post.publishResults[resultIndex].error = 'Post deleted from platform';
      post.markModified('publishResults');
      await post.save();
    }

    return { success: true, message: 'Facebook post deleted successfully' };
  }

  async deleteInstagramPost(userId: string, postId: string) {
    const post = await this.findOne(userId, postId);

    const igResult = post.publishResults?.find((r) => r.platform === PostPlatform.INSTAGRAM && r.success && r.platformPostId);
    if (!igResult) {
      throw new BadRequestException('Instagram post not found or not published successfully');
    }

    const accountsWithTokens = await this.socialAccountsService.getAccountsForPlatforms(
      userId,
      [PostPlatform.INSTAGRAM as unknown as SocialPlatform],
    );

    const accountItem = accountsWithTokens.find(
      (a) => (a.account.platform as unknown as string) === (PostPlatform.INSTAGRAM as unknown as string),
    );

    if (!accountItem) {
      throw new BadRequestException('Linked Instagram account not found');
    }

    await this.instagramService.deleteMedia(
      accountItem.account.accountId,
      accountItem.decryptedToken,
      igResult.platformPostId as string,
      accountItem.decryptedToken.startsWith('IG'),
    );

    // Optionally mark the platform as deleted in the DB
    const resultIndex = post.publishResults.findIndex((r) => r.platform === PostPlatform.INSTAGRAM);
    if (resultIndex > -1) {
      post.publishResults[resultIndex].success = false;
      post.publishResults[resultIndex].error = 'Post deleted from platform';
      post.markModified('publishResults');
      await post.save();
    }

    return { success: true, message: 'Instagram post deleted successfully' };
  }
}
