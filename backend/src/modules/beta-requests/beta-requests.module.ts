import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BetaRequestsController } from './beta-requests.controller';
import { BetaRequestsService } from './beta-requests.service';
import { BetaRequest, BetaRequestSchema } from './schemas/beta-request.schema';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: BetaRequest.name, schema: BetaRequestSchema },
        ]),
        UsersModule,
        forwardRef(() => AuthModule),
    ],
    controllers: [BetaRequestsController],
    providers: [BetaRequestsService],
})
export class BetaRequestsModule { }
