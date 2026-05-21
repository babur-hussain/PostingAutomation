import {
    Injectable,
    Logger,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { google } from 'googleapis';
import {
    SubscriptionReceipt,
    SubscriptionReceiptDocument,
} from './schemas/subscription-receipt.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { VerifySubscriptionDto } from './dto/verify-subscription.dto';

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        @InjectModel(SubscriptionReceipt.name)
        private receiptModel: Model<SubscriptionReceiptDocument>,
        @InjectModel(User.name)
        private userModel: Model<UserDocument>,
        private configService: ConfigService,
    ) { }

    /**
     * Verify a Google Play subscription purchase token with the Google Play
     * Developer API and update the user's plan accordingly.
     */
    async verifyAndActivate(
        userId: string,
        dto: VerifySubscriptionDto,
    ): Promise<{ status: string; plan: string; expiryDate: string | null }> {
        const { productId, purchaseToken } = dto;

        // Build Google API auth from the service-account JSON stored in env
        const serviceAccountJson = this.configService.get<string>(
            'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
        );

        if (!serviceAccountJson) {
            throw new InternalServerErrorException(
                'Google Play service account not configured',
            );
        }

        let subscriptionData: any;
        try {
            const credentials = JSON.parse(serviceAccountJson);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/androidpublisher'],
            });

            const androidPublisher = google.androidpublisher({ version: 'v3', auth });
            const packageName = this.configService.get<string>(
                'GOOGLE_PLAY_PACKAGE_NAME',
            );

            const response =
                await androidPublisher.purchases.subscriptionsv2.get({
                    packageName,
                    token: purchaseToken,
                });

            subscriptionData = response.data;
        } catch (err) {
            this.logger.error('Google Play verification failed', err);
            throw new BadRequestException(
                'Could not verify purchase token with Google Play',
            );
        }

        // Parse subscription state
        // subscriptionState: SUBSCRIPTION_STATE_ACTIVE | EXPIRED | CANCELED | PAUSED | IN_GRACE_PERIOD | ON_HOLD …
        const subscriptionState: string =
            subscriptionData.subscriptionState ?? 'UNKNOWN';
        const lineItem = subscriptionData.lineItems?.[0];
        const expiryTimeMillis: string | null =
            lineItem?.expiryTime ?? null;

        const isActive = subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' ||
            subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';

        const receiptStatus = isActive ? 'active' : 'expired';
        const plan = isActive ? 'pro' : 'free';

        // Upsert the receipt record (idempotent on purchaseToken)
        await this.receiptModel.findOneAndUpdate(
            { purchaseToken },
            {
                userId: new Types.ObjectId(userId),
                productId,
                purchaseToken,
                orderId: subscriptionData.latestOrderId ?? '',
                expiryDate: expiryTimeMillis,
                status: receiptStatus,
                rawResponse: subscriptionData,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Update user plan
        await this.userModel.findByIdAndUpdate(userId, {
            plan,
            subscriptionProductId: productId,
            subscriptionExpiryDate: expiryTimeMillis,
        });

        this.logger.log(
            `User ${userId} subscription verified: state=${subscriptionState}, plan=${plan}`,
        );

        return { status: subscriptionState, plan, expiryDate: expiryTimeMillis };
    }

    /**
     * Get the current subscription status for a user.
     */
    async getStatus(
        userId: string,
    ): Promise<{ plan: string; expiryDate: string | null; productId: string | null }> {
        const user = await this.userModel.findById(userId).lean();
        return {
            plan: user?.plan ?? 'free',
            expiryDate: (user as any)?.subscriptionExpiryDate ?? null,
            productId: (user as any)?.subscriptionProductId ?? null,
        };
    }

    /**
     * Handle a Google Play Real-time Developer Notification (RTDN) via Pub/Sub.
     * The payload arrives base64-encoded in the request body.
     */
    async handleRtdn(encodedData: string): Promise<void> {
        let notification: any;
        try {
            const decoded = Buffer.from(encodedData, 'base64').toString('utf-8');
            notification = JSON.parse(decoded);
        } catch {
            this.logger.warn('Failed to decode RTDN payload');
            return;
        }

        const subscriptionNotification = notification?.subscriptionNotification;
        if (!subscriptionNotification) return;

        const { purchaseToken, notificationType } = subscriptionNotification;
        this.logger.log(`RTDN received: type=${notificationType}, token=${purchaseToken?.slice(0, 20)}...`);

        // Find the receipt and re-verify
        const receipt = await this.receiptModel.findOne({ purchaseToken });
        if (!receipt) {
            this.logger.warn(`No receipt found for purchaseToken in RTDN`);
            return;
        }

        await this.verifyAndActivate(receipt.userId.toString(), {
            productId: receipt.productId,
            purchaseToken,
        });
    }
}
