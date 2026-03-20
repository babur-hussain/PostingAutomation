import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SocialAccountDocument = HydratedDocument<SocialAccount>;

// #23: Values kept in sync with PostPlatform in post.schema.ts
export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  YOUTUBE = 'youtube',
  X = 'x',
  THREADS = 'threads',
}

@Schema({ timestamps: true, collection: 'social_accounts' })
export class SocialAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: SocialPlatform, required: true })
  platform: SocialPlatform;

  @Prop({ required: true })
  accessToken: string;

  @Prop({ default: null })
  refreshToken: string;

  @Prop({ default: null })
  tokenExpiry: Date;

  @Prop({ required: true })
  accountId: string;

  @Prop({ required: true })
  accountName: string;
}

export const SocialAccountSchema = SchemaFactory.createForClass(SocialAccount);

SocialAccountSchema.index(
  { userId: 1, platform: 1, accountId: 1 },
  { unique: true },
);
