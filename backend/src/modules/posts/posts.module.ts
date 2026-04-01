import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { Post, PostSchema } from './schemas/post.schema';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';
import { FacebookService } from '../../integrations/facebook/facebook.service';
import { InstagramService } from '../../integrations/instagram/instagram.service';
import { ThreadsService } from '../../integrations/threads/threads.service';
import { InstagramController } from '../../integrations/instagram/instagram.controller';
import { FacebookController } from '../../integrations/facebook/facebook.controller';
import { YouTubeService } from '../../integrations/youtube/youtube.service';
import { ImageResizeService } from '../../common/services/image-resize.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]),
    SchedulerModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    forwardRef(() => SocialAccountsModule),
  ],
  controllers: [PostsController, InstagramController, FacebookController],
  providers: [PostsService, FacebookService, InstagramService, ThreadsService, YouTubeService, ImageResizeService],
  exports: [PostsService],
})
export class PostsModule { }
