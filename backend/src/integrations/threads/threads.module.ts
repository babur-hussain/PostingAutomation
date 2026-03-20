import { Module, forwardRef } from '@nestjs/common';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { SocialAccountsModule } from '../../modules/social-accounts/social-accounts.module';
import { AuthModule } from '../../modules/auth/auth.module';

@Module({
  imports: [forwardRef(() => SocialAccountsModule), AuthModule],
  controllers: [ThreadsController],
  providers: [ThreadsService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
