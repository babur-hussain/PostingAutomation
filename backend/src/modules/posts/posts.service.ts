import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';
import { CreatePostDto } from './dto/create-post.dto';
import { PostSchedulerService } from '../scheduler/services/post-scheduler.service';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private postSchedulerService: PostSchedulerService,
  ) {}

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
}
