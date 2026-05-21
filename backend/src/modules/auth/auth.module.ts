import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { FirebaseService } from './firebase.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [ConfigModule, forwardRef(() => UsersModule)],
  controllers: [AuthController],
  providers: [AuthService, FirebaseService, NotificationService],
  exports: [AuthService, FirebaseService, UsersModule, NotificationService],
})
export class AuthModule { }
