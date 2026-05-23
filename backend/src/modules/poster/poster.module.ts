import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PosterService } from './poster.service';
import { PosterController } from './poster.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MediaModule } from '../media/media.module';
import { GeneratedPoster, GeneratedPosterSchema } from './schemas/generated-poster.schema';
import { PendingPosterTask, PendingPosterTaskSchema } from './schemas/pending-poster-task.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GeneratedPoster.name, schema: GeneratedPosterSchema },
      { name: PendingPosterTask.name, schema: PendingPosterTaskSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    MediaModule,
  ],
  controllers: [PosterController],
  providers: [PosterService],
})
export class PosterModule {}
