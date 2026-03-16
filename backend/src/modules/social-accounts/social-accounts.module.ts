import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { SocialAccountsService } from './social-accounts.service';
import { SocialAccountsController } from './social-accounts.controller';

import { InstagramProvider } from './providers/instagram.provider';
import { FacebookProvider } from './providers/facebook.provider';
import { YouTubeProvider } from './providers/youtube.provider';
import { XProvider } from './providers/x.provider';
import { ThreadsProvider } from './providers/threads.provider';
import {
  SocialAccount,
  SocialAccountSchema,
} from './schemas/social-account.schema';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
@Module({
  imports: [
    AuthModule,
    UsersModule,
    ConfigModule,
    MongooseModule.forFeature([
      { name: SocialAccount.name, schema: SocialAccountSchema },
    ]),
  ],
  controllers: [SocialAccountsController],
  providers: [
    SocialAccountsService,
    InstagramProvider,
    FacebookProvider,
    YouTubeProvider,
    XProvider,
    ThreadsProvider,
  ],
  exports: [SocialAccountsService],
})
export class SocialAccountsModule { }
