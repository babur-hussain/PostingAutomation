import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { Media, MediaSchema } from './schemas/media.schema';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    ConfigModule,
    MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
    MulterModule.register({
      storage: require('multer').memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule { }
