import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GeneratedPosterDocument = HydratedDocument<GeneratedPoster>;

@Schema({ timestamps: true, collection: 'generated_posters' })
export class GeneratedPoster {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  festivalName: string;

  @Prop({ required: true })
  festivalDate: string;

  @Prop({ required: true })
  s3Url: string;

  @Prop()
  promptUsed?: string;
}

export const GeneratedPosterSchema = SchemaFactory.createForClass(GeneratedPoster);

// Index to quickly fetch a user's poster for a specific festival
GeneratedPosterSchema.index({ userId: 1, festivalName: 1 });
