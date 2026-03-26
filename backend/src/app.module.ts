import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';

import configuration from './config/configuration';
import { databaseConfig } from './config/database.config';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SocialAccountsModule } from './modules/social-accounts/social-accounts.module';
import { PostsModule } from './modules/posts/posts.module';
import { MediaModule } from './modules/media/media.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ThreadsModule } from './integrations/threads/threads.module';
import { MessagesModule } from './modules/messages/messages.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { HealthModule } from './modules/health/health.module';
import { StaticModule } from './modules/static/static.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync(databaseConfig),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/public',
    }),
    UsersModule,
    AuthModule,
    SocialAccountsModule,
    PostsModule,
    MediaModule,
    SchedulerModule,
    LocationsModule,
    ThreadsModule,
    MessagesModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [
    // Apply rate limiting globally (60 req/min default, overridable per-route)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
