import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PostDocument = HydratedDocument<Post>;

export enum PostStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PUBLISHED = 'published',
  FAILED = 'failed',
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
}

export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({ userId: 1, createdAt: -1 });
PostSchema.index({ status: 1, scheduledTime: 1 });
