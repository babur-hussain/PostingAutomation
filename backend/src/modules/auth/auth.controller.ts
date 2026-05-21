import { Controller, UseGuards, Get, Patch, Body, Delete } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, IsEmail, IsBoolean } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

// #49: DTO for notification preferences sync
class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @IsOptional() @IsBoolean() postReminders?: boolean;
  @IsOptional() @IsBoolean() weeklyDigest?: boolean;
  @IsOptional() @IsBoolean() postSuccess?: boolean;
  @IsOptional() @IsBoolean() postFailure?: boolean;
}

class UpdateFcmTokenDto {
  @IsString()
  token: string;
}

// #9: Stricter rate limiting for auth endpoints (30 req/min instead of global 60)
@Throttle({ default: { ttl: 60000, limit: 30 } })
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @UseGuards(FirebaseAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  @UseGuards(FirebaseAuthGuard)
  @Patch('profile')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, body);
  }

  @UseGuards(FirebaseAuthGuard)
  @Patch('notification-preferences')
  async updateNotificationPreferences(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return this.authService.updateNotificationPreferences(userId, body);
  }

  @UseGuards(FirebaseAuthGuard)
  @Get('account') // Temporary alias for profile/account info if needed
  async getAccount(@CurrentUser('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  @UseGuards(FirebaseAuthGuard)
  @Patch('fcm-token')
  async addFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateFcmTokenDto,
  ) {
    return this.authService.addFcmToken(userId, body.token);
  }

  @UseGuards(FirebaseAuthGuard)
  @Delete('fcm-token')
  async removeFcmToken(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateFcmTokenDto,
  ) {
    return this.authService.removeFcmToken(userId, body.token);
  }

  @UseGuards(FirebaseAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 1 } }) // Extremely strict for deletion
  @Delete('account')
  async deleteAccount(@CurrentUser('userId') userId: string) {
    return this.authService.deleteAccount(userId);
  }
}
