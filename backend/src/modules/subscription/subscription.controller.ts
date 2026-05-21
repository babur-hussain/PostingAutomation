import {
    Controller,
    Post,
    Get,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubscriptionService } from './subscription.service';
import { VerifySubscriptionDto } from './dto/verify-subscription.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/subscription')
export class SubscriptionController {
    private readonly logger = new Logger(SubscriptionController.name);

    constructor(private readonly subscriptionService: SubscriptionService) { }

    /**
     * POST /api/v1/subscription/verify
     * Called by the mobile app right after a successful Google Play purchase.
     * Verifies the token with Google and activates the user's subscription.
     */
    @UseGuards(FirebaseAuthGuard)
    @Throttle({ default: { ttl: 60000, limit: 10 } })
    @Post('verify')
    @HttpCode(HttpStatus.OK)
    async verify(
        @CurrentUser('userId') userId: string,
        @Body() dto: VerifySubscriptionDto,
    ) {
        return this.subscriptionService.verifyAndActivate(userId, dto);
    }

    /**
     * GET /api/v1/subscription/status
     * Returns the current subscription plan and expiry for the authenticated user.
     */
    @UseGuards(FirebaseAuthGuard)
    @Get('status')
    async status(@CurrentUser('userId') userId: string) {
        return this.subscriptionService.getStatus(userId);
    }

    /**
     * POST /api/v1/subscription/rtdn
     * Google Pub/Sub push endpoint for Real-time Developer Notifications.
     * This endpoint must be registered as the push subscription URL in GCP.
     * It is intentionally unauthenticated (Google signs the push request differently).
     */
    @Post('rtdn')
    @HttpCode(HttpStatus.NO_CONTENT)
    async rtdn(@Body() body: { message?: { data?: string } }) {
        const encoded = body?.message?.data;
        if (!encoded) {
            this.logger.warn('RTDN received with no message.data');
            return;
        }
        await this.subscriptionService.handleRtdn(encoded);
    }
}
