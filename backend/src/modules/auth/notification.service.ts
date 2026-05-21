import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseService } from './firebase.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private firebaseService: FirebaseService,
    private usersService: UsersService,
  ) {}

  async sendPushNotification(userId: string, title: string, body: string, data?: any) {
    try {
      const user = await this.usersService.findById(userId);
      if (!user || !(user as any).fcmTokens || (user as any).fcmTokens.length === 0) {
        return { success: false, message: 'No FCM tokens found for user' };
      }

      // Check master toggle
      if ((user as any).notificationPreferences && !(user as any).notificationPreferences.pushEnabled) {
          return { success: false, message: 'User has push notifications disabled' };
      }

      const tokens = (user as any).fcmTokens;
      
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title,
          body,
        },
        data: data || {},
      });

      this.logger.log(`Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
      
      // Clean up failed tokens (e.g., token expired or uninstalled)
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
          }
        });
        
        if (failedTokens.length > 0) {
            (user as any).fcmTokens = tokens.filter((t: string) => !failedTokens.includes(t));
            await (user as any).save();
        }
      }

      return { success: true, sentCount: response.successCount };
    } catch (error) {
      this.logger.error('Error sending push notification', error);
      return { success: false, error };
    }
  }
}
