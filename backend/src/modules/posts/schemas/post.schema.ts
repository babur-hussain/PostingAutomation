import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PostDocument = HydratedDocument<Post>;

export enum PostStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export class PublishResult {
  platform: PostPlatform;
  success: boolean;
  platformPostId?: string;
  error?: string;
  publishedAt?: Date;
}

export class AnalyticsData {
  platform: PostPlatform;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  clicks?: number;
  engagementRate?: number;
  lastUpdated: Date;
}

export class LocationInfo {
  name: string;
  lat: number;
  lng: number;
}

export enum PostPlatform {
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  YOUTUBE = 'youtube',
  X = 'x',
  THREADS = 'threads',
}

@Schema({ timestamps: true, collection: 'posts' })
export class Post {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ default: '' })
  caption: string;

  @Prop({ default: null })
  mediaUrl: string;

  @Prop({ type: [String], enum: PostPlatform, required: true })
  platforms: PostPlatform[];

  @Prop({ default: null })
  scheduledTime: Date;

  @Prop({ type: String, enum: PostStatus, default: PostStatus.PENDING })
  status: PostStatus;

  @Prop({ type: Array, default: [] })
  publishResults: PublishResult[];

  @Prop({ type: Array, default: [] })
  analytics: AnalyticsData[];

  @Prop({ type: Object, default: null })
  location?: LocationInfo;
}

export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({ userId: 1, createdAt: -1 });
PostSchema.index({ status: 1, scheduledTime: 1 });
