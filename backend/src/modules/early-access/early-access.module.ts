import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EarlyAccessController } from './early-access.controller';
import { EarlyAccessService } from './early-access.service';
import { EarlyAccess, EarlyAccessSchema } from './schemas/early-access.schema';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: EarlyAccess.name, schema: EarlyAccessSchema }
        ]),
        ScheduleModule.forRoot(),
    ],
    controllers: [EarlyAccessController],
    providers: [EarlyAccessService],
})
export class EarlyAccessModule { }
