import { Module, forwardRef } from '@nestjs/common';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { SocialAccountsModule } from '../../modules/social-accounts/social-accounts.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { ImageResizeService } from '../../common/services/image-resize.service';

@Module({
  imports: [forwardRef(() => SocialAccountsModule), AuthModule],
  controllers: [ThreadsController],
  providers: [ThreadsService, ImageResizeService],
  exports: [ThreadsService],
})
export class ThreadsModule { }
