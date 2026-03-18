import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]),
    SchedulerModule,
    AuthModule,
    UsersModule,
    SocialAccountsModule,
  ],
  controllers: [PostsController],
  providers: [PostsService, FacebookService, InstagramService],
  exports: [PostsService],
})
export class PostsModule {}
