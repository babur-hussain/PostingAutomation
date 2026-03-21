import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SocialAccountsModule, AuthModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesGateway],
})
export class MessagesModule {}
