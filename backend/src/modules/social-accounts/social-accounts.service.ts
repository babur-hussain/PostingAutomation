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

import { InstagramProvider } from './providers/instagram.provider';
import { FacebookProvider } from './providers/facebook.provider';
import { YouTubeProvider } from './providers/youtube.provider';

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectModel(SocialAccount.name)
    private socialAccountModel: Model<SocialAccountDocument>,
    private configService: ConfigService,
    private instagramProvider: InstagramProvider,
    private facebookProvider: FacebookProvider,
    private youtubeProvider: YouTubeProvider,
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
      case SocialPlatform.YOUTUBE:
        return this.youtubeProvider.getAuthorizationUrl(state);
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
    } else if (platform === SocialPlatform.YOUTUBE) {
      return this.handleYouTubeCallback(userId, code);
    }

    throw new BadRequestException('Unsupported platform');
  }

  /**
   * Handle the Facebook OAuth callback explicitly.
   * Completely isolated from Instagram logic.
   */
  async handleFacebookCallback(
    code: string,
    state: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    const { userId, platform } = stateData;

    if (platform !== SocialPlatform.FACEBOOK) {
      throw new BadRequestException('Expected Facebook platform for this callback');
    }

    // Facebook Login: use standalone Facebook token exchange
    const { accessToken: shortToken } =
      await this.facebookProvider.exchangeCodeForToken(code);
    const { accessToken: longToken, expiresIn } =
      await this.facebookProvider.getLongLivedToken(shortToken);

    return this.connectFacebookPage(userId, longToken, expiresIn);
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
      const longLived =
        await this.instagramProvider.getLongLivedToken(shortToken);
      token = longLived.accessToken;
      expiresIn = longLived.expiresIn;
      this.logger.log('Successfully obtained long-lived Instagram token');
    } catch (err) {
      const errBody = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
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
      const errBody = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
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

  async connectFacebookPage(
    userId: string,
    accessToken: string,
    expiresIn: number,
  ) {
    const pages = await this.facebookProvider.getUserPages(accessToken);
    if (!pages || !pages.length) {
      throw new BadRequestException(
        'No Facebook Pages found for this account. Make sure you have created a Page.',
      );
    }

    this.logger.log(`Found ${pages.length} Facebook Pages to connect...`);

    const connectedNames: string[] = [];

    // Connect ALL pages the user manages
    for (const page of pages) {
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
          profilePicture: page.picture || null,
        },
        { upsert: true, new: true },
      );

      connectedNames.push(page.name);
    }

    return {
      platform: SocialPlatform.FACEBOOK as SocialPlatform,
      accountName:
        connectedNames.length > 1
          ? `${connectedNames.length} Pages connected`
          : connectedNames[0],
    };
  }

  /**
   * Handle YouTube / Google OAuth callback.
   * Exchanges code for tokens, gets channel info, stores with refresh token.
   */
  private async handleYouTubeCallback(
    userId: string,
    code: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    // 1. Exchange code for access + refresh tokens
    const { accessToken, refreshToken, expiresIn } =
      await this.youtubeProvider.exchangeCodeForTokens(code);

    this.logger.log('Successfully obtained YouTube tokens');

    // 2. Get YouTube channel info
    const channelInfo = await this.youtubeProvider.getChannelInfo(accessToken);
    this.logger.log(
      `Got YouTube channel: ${channelInfo.channelTitle} (${channelInfo.channelId})`,
    );

    // 3. Store the account with encrypted tokens
    const encryptedAccessToken = this.encrypt(accessToken);
    const encryptedRefreshToken = refreshToken
      ? this.encrypt(refreshToken)
      : null;

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        platform: SocialPlatform.YOUTUBE,
        accountId: channelInfo.channelId,
      },
      {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000),
        accountName: channelInfo.channelTitle,
        profilePicture: channelInfo.thumbnailUrl || null,
      },
      { upsert: true, new: true },
    );

    return {
      platform: SocialPlatform.YOUTUBE,
      accountName: channelInfo.channelTitle,
    };
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

  /**
   * Manually connect an Instagram account using a raw access token.
   * For testing / Meta app review — bypasses the OAuth code exchange flow.
   */
  async connectWithToken(
    userId: string,
    platform: SocialPlatform,
    accessToken: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    if (platform !== SocialPlatform.INSTAGRAM) {
      throw new BadRequestException(
        'Manual token connection is currently only supported for Instagram',
      );
    }

    // Determine proper Business Account ID by querying connected pages
    let businessAccountId = 'unknown';
    let accountName = 'Instagram User';
    const profilePictureUrl = null;

    try {
      // Query Facebook Pages connected to this user token to find linked Instagram Business Accounts
      const response = await require('axios').get(
        `https://graph.facebook.com/v22.0/me/accounts?fields=instagram_business_account,name,picture&access_token=${accessToken}`,
      );

      const pages = response.data.data || [];
      const pageWithIg = pages.find((p: any) => p.instagram_business_account);

      if (pageWithIg) {
        businessAccountId = pageWithIg.instagram_business_account.id;
        accountName = pageWithIg.name; // fallback to page name if IG profile fails
        this.logger.log(
          `[ManualConnect] Found linked IG Business ID: ${businessAccountId} on Page: ${pageWithIg.name}`,
        );
      } else {
        this.logger.warn(
          `[ManualConnect] No linked Instagram Business account found on user's pages.`,
        );
      }

      // Also try to get the basic Instagram profile for name/picture using the basic display API
      const profile = await this.instagramProvider.getUserProfile(accessToken);
      if (profile.username) accountName = profile.username;
    } catch (err) {
      const errBody = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
      this.logger.warn(
        `[ManualConnect] Failed to fetch business account ID or profile: ${errBody}`,
      );
    }

    // Encrypt and store
    const encryptedToken = this.encrypt(accessToken);

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        platform: SocialPlatform.INSTAGRAM,
        accountId: businessAccountId, // Store the dynamically fetched Business Account ID
      },
      {
        accessToken: encryptedToken,
        tokenExpiry: new Date(Date.now() + 5184000 * 1000), // ~60 days
        accountName,
        profilePicture: profilePictureUrl,
      },
      { upsert: true, new: true },
    );

    return {
      platform: SocialPlatform.INSTAGRAM,
      accountName,
    };
  }

  async getAccountsForPlatforms(
    userId: string,
    platforms: SocialPlatform[],
  ): Promise<
    Array<{ account: SocialAccountDocument; decryptedToken: string }>
  > {
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
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
