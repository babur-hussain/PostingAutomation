import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PendingPosterTaskDocument = HydratedDocument<PendingPosterTask>;

@Schema({ timestamps: true, collection: 'pending_poster_tasks' })
export class PendingPosterTask {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  taskId: string;

  @Prop({ required: true })
  festivalName: string;

  @Prop({ required: true })
  festivalDate: string;

  @Prop({ required: true, default: 'waiting' })
  status: string;
}

export const PendingPosterTaskSchema = SchemaFactory.createForClass(PendingPosterTask);
