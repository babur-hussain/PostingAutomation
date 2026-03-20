import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private usersService: UsersService) { }

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user._id,
      email: user.email,
      name: user.name,
      plan: (user as any).plan || 'free',
      createdAt: (user as any).createdAt,
    };
  }

  async updateProfile(userId: string, data: { name?: string }) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (data.name) {
      user.name = data.name.trim();
    }
    await (user as any).save();
    return {
      id: user._id,
      email: user.email,
      name: user.name,
      plan: (user as any).plan || 'free',
      createdAt: (user as any).createdAt,
    };
  }

  // #49: Sync notification preferences from mobile client
  async updateNotificationPreferences(userId: string, prefs: Partial<{ pushEnabled: boolean; postReminders: boolean; weeklyDigest: boolean; postSuccess: boolean; postFailure: boolean }>) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const current = (user as any).notificationPreferences || {};
    (user as any).notificationPreferences = { ...current, ...prefs };
    await (user as any).save();
    return { notificationPreferences: (user as any).notificationPreferences };
  }
}

