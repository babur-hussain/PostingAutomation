import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';
import { PostsModule } from '../posts/posts.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => SocialAccountsModule),
    forwardRef(() => PostsModule),
    forwardRef(() => MediaModule),
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
