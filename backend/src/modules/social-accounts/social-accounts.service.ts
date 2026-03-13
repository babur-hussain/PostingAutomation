import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  SocialAccount,
  SocialAccountDocument,
  SocialPlatform,
} from './schemas/social-account.schema';
import { MetaProvider } from './providers/meta.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { FacebookProvider } from './providers/facebook.provider';

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectModel(SocialAccount.name)
    private socialAccountModel: Model<SocialAccountDocument>,
    private configService: ConfigService,
    private metaProvider: MetaProvider,
    private instagramProvider: InstagramProvider,
    private facebookProvider: FacebookProvider,
  ) {
    const key = this.configService.get<string>('encryption.key');
    this.encryptionKey = Buffer.from(key || '0'.repeat(64), 'hex');
  }

  /**
   * Get the OAuth authorization URL for the given platform.
   */
  getConnectUrl(platform: SocialPlatform, userId: string): string {
    const state = Buffer.from(
      JSON.stringify({ userId, platform, ts: Date.now() }),
    ).toString('base64url');

    switch (platform) {
      case SocialPlatform.INSTAGRAM:
        return this.instagramProvider.getAuthorizationUrl(state);
      case SocialPlatform.FACEBOOK:
        return this.facebookProvider.getAuthorizationUrl(state);
      default:
        throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Handle the OAuth callback.
   * Instagram and Facebook use different token exchange flows.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    const { userId, platform } = stateData;

    if (platform === SocialPlatform.INSTAGRAM) {
      // Instagram Business Login: use Instagram's own token exchange
      return this.handleInstagramCallback(userId, code);
    } else if (platform === SocialPlatform.FACEBOOK) {
      // Facebook Login: use Meta/Facebook token exchange
      const { accessToken: shortToken } =
        await this.metaProvider.exchangeCodeForToken(code);
      const { accessToken: longToken, expiresIn } =
        await this.metaProvider.getLongLivedToken(shortToken);
      return this.connectFacebookPage(userId, longToken, expiresIn);
    }

    throw new BadRequestException('Unsupported platform');
  }

  /**
   * Handle Instagram Business Login callback.
   * Uses Instagram's own token exchange and user profile endpoints.
   */
  private async handleInstagramCallback(
    userId: string,
    code: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    // 1. Exchange code for short-lived token via Instagram API
    const { accessToken: shortToken, userId: igUserId } =
      await this.instagramProvider.exchangeCodeForToken(code);

    // 2. Try to get long-lived token (~60 days), fall back to short-lived if it fails
    let token = shortToken;
    let expiresIn = 3600; // short-lived = 1 hour
    try {
      const longLived = await this.instagramProvider.getLongLivedToken(shortToken);
      token = longLived.accessToken;
      expiresIn = longLived.expiresIn;
      this.logger.log('Successfully obtained long-lived Instagram token');
    } catch (err) {
      const errBody = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
      this.logger.warn(`Failed to get long-lived token: ${errBody}`);
    }

    // 3. Get user profile from Instagram (may fail if permissions not fully approved)
    let profile: {
      userId: string;
      username: string;
      name: string;
      profilePictureUrl?: string;
    } = {
      userId: igUserId,
      username: `instagram_user_${igUserId}`,
      name: `Instagram User`,
    };
    try {
      profile = await this.instagramProvider.getUserProfile(token);
      this.logger.log(`Got Instagram profile: ${profile.username}`);
    } catch (err) {
      const errBody = err?.response?.data ? JSON.stringify(err.response.data) : err?.message;
      this.logger.warn(`Failed to get Instagram profile: ${errBody}`);
    }

    // 4. Store the account
    const encryptedToken = this.encrypt(token);

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        platform: SocialPlatform.INSTAGRAM,
        accountId: igUserId || profile.userId,
      },
      {
        accessToken: encryptedToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000),
        accountName: profile.username || profile.name,
        profilePicture: profile.profilePictureUrl || null,
      },
      { upsert: true, new: true },
    );

    return {
      platform: SocialPlatform.INSTAGRAM,
      accountName: profile.username || profile.name,
    };
  }

  async connectFacebookPage(userId: string, accessToken: string, expiresIn: number) {
    const pages = await this.metaProvider.getUserPages(accessToken);
    if (!pages.length) {
      throw new BadRequestException('No Facebook Pages found for this account. Make sure you have created a Page.');
    }

    const page = pages[0]; // Connecting the first page found
    const encryptedToken = this.encrypt(page.accessToken);

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        platform: SocialPlatform.FACEBOOK,
        accountId: page.id,
      },
      {
        accessToken: encryptedToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000),
        accountName: page.name,
      },
      { upsert: true, new: true },
    );

    return { platform: SocialPlatform.FACEBOOK, accountName: page.name };
  }

  async getAccounts(userId: string): Promise<SocialAccountDocument[]> {
    return this.socialAccountModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('-accessToken -refreshToken')
      .sort({ createdAt: -1 });
  }

  async disconnectAccount(userId: string, accountId: string): Promise<void> {
    const result = await this.socialAccountModel.deleteOne({
      _id: accountId,
      userId: new Types.ObjectId(userId),
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Account not found');
    }
  }

  async getAccountsForPlatforms(
    userId: string,
    platforms: SocialPlatform[],
  ): Promise<Array<{ account: SocialAccountDocument; decryptedToken: string }>> {
    const accounts = await this.socialAccountModel.find({
      userId: new Types.ObjectId(userId),
      platform: { $in: platforms },
    });

    return accounts.map((account) => ({
      account,
      decryptedToken: this.decrypt(account.accessToken),
    }));
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
