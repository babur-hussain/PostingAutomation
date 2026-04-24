import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BetaRequestDocument = BetaRequest & Document;

@Schema({ timestamps: true })
export class BetaRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: false })
  instagramUrl?: string;

  @Prop({ type: String, required: false })
  facebookUrl?: string;

  @Prop({ type: String, required: false })
  threadsUrl?: string;

  @Prop({ type: String, default: 'pending', enum: ['pending', 'approved'] })
  status: string;
}

export const BetaRequestSchema = SchemaFactory.createForClass(BetaRequest);
