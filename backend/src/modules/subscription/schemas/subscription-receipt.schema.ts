import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SubscriptionReceiptDocument = HydratedDocument<SubscriptionReceipt>;

@Schema({ timestamps: true, collection: 'subscription_receipts' })
export class SubscriptionReceipt {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  /** Google Play subscription product ID, e.g. "premium_monthly" */
  @Prop({ required: true })
  productId: string;

  /** The purchaseToken returned by Google Play on the device */
  @Prop({ required: true, unique: true })
  purchaseToken: string;

  /** Google's orderId */
  @Prop()
  orderId: string;

  /** ISO-8601 string of when the subscription expires/renews */
  @Prop()
  expiryDate: string;

  /** Status as returned by Google Play API */
  @Prop({ default: 'pending', enum: ['pending', 'active', 'expired', 'cancelled', 'revoked'] })
  status: string;

  /** Raw Google Play API response for debugging */
  @Prop({ type: Object })
  rawResponse: Record<string, unknown>;
}

export const SubscriptionReceiptSchema = SchemaFactory.createForClass(SubscriptionReceipt);
