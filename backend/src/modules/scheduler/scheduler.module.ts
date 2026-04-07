import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PostSchedulerService } from './services/post-scheduler.service';
import { QueueWorker } from './processors/queue.worker';
import { Post, PostSchema } from '../posts/schemas/post.schema';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';
import { InstagramService } from '../../integrations/instagram/instagram.service';
import { FacebookService } from '../../integrations/facebook/facebook.service';
import { YouTubeService } from '../../integrations/youtube/youtube.service';
import { XService } from '../../integrations/x/x.service';
import { ThreadsService } from '../../integrations/threads/threads.service';
import { ImageResizeService } from '../../common/services/image-resize.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    // Register the queue with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
          password: configService.get<string>('redis.password'),
          tls: configService.get<boolean>('redis.tls') ? {} : undefined,
        },
      }),
    }),
    // Register the specific queue for posts
    BullModule.registerQueue({
      name: 'posts',
    }),
    // Expose Post schema for the processor
    MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]),
    // Import needed modules
    SocialAccountsModule,
    MediaModule,
  ],
  providers: [
    PostSchedulerService,
    QueueWorker,
    InstagramService,
    FacebookService,
    YouTubeService,
    XService,
    ThreadsService,
    ImageResizeService,
  ],
  exports: [PostSchedulerService],
})
export class SchedulerModule { }
