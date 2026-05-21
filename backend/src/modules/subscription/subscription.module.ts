import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import {
    SubscriptionReceipt,
    SubscriptionReceiptSchema,
} from './schemas/subscription-receipt.schema';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([
            { name: SubscriptionReceipt.name, schema: SubscriptionReceiptSchema },
            { name: User.name, schema: UserSchema },
        ]),
        forwardRef(() => UsersModule),
        forwardRef(() => AuthModule),
    ],
    controllers: [SubscriptionController],
    providers: [SubscriptionService],
    exports: [SubscriptionService],
})
export class SubscriptionModule { }
