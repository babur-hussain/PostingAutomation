import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MediaDocument = HydratedDocument<Media>;

@Schema({ timestamps: true, collection: 'media' })
export class Media {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  s3Key: string;

  @Prop({ required: true })
  s3Url: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  sizeBytes: number;

  @Prop({ default: null })
  originalName: string;
}

export const MediaSchema = SchemaFactory.createForClass(Media);
