import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ unique: true, sparse: true })
  firebaseUid: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ select: false })
  password: string;

  @Prop({ default: 'free', enum: ['free', 'pro', 'enterprise'] })
  plan: string;

  /** Google Play product ID of the active subscription, e.g. "premium_monthly" */
  @Prop()
  subscriptionProductId: string;

  /** ISO-8601 expiry date returned by Google Play API */
  @Prop()
  subscriptionExpiryDate: string;

  // #49: Notification preferences synced from mobile client
  @Prop({
    type: Object,
    default: {
      pushEnabled: true,
      postReminders: true,
      weeklyDigest: false,
      postSuccess: true,
      postFailure: true,
    },
  })
  notificationPreferences: {
    pushEnabled: boolean;
    postReminders: boolean;
    weeklyDigest: boolean;
    postSuccess: boolean;
    postFailure: boolean;
  };

  @Prop({ type: [String], default: [] })
  fcmTokens: string[];
}

export const UserSchema = SchemaFactory.createForClass(User);
// Removed redundant UserSchema.index({ email: 1 }) — field already has unique: true
