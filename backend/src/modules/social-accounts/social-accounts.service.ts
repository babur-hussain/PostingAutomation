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
import axios from 'axios';
import {
  SocialAccount,
  SocialAccountDocument,
  SocialPlatform,
} from './schemas/social-account.schema';

import { InstagramProvider } from './providers/instagram.provider';
import { FacebookProvider } from './providers/facebook.provider';
import { YouTubeProvider } from './providers/youtube.provider';
import { XProvider } from './providers/x.provider';
import { ThreadsProvider } from './providers/threads.provider';

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
    private xProvider: XProvider,
    private threadsProvider: ThreadsProvider,
  ) {
    const key = this.configService.get<string>('encryption.key');
    if (!key) {
      throw new Error(
        'FATAL: encryption.key is not set. Refusing to start with insecure defaults. ' +
        'Set the ENCRYPTION_KEY environment variable (64-char hex string).',
      );
    }
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  /**
   * Get the OAuth authorization URL for the given platform.
   */
  /**
   * Create an HMAC-signed state parameter to prevent OAuth state forgery.
   */
  private signState(payload: object): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.encryptionKey)
      .update(data)
      .digest('base64url');
    return `${data}.${signature}`;
  }

  /**
   * Verify and decode an HMAC-signed state parameter.
   * Throws if the signature is invalid.
   */
  verifyState(state: string): { userId: string; platform: string; ts: number } {
    const [data, signature] = state.split('.');
    if (!data || !signature) {
      throw new BadRequestException('Invalid OAuth state format');
    }
    const expected = crypto
      .createHmac('sha256', this.encryptionKey)
      .update(data)
      .digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    // timingSafeEqual requires equal-length buffers; different lengths = invalid signature
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new BadRequestException('Invalid OAuth state signature — possible CSRF attack');
    }
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  }

  async getConnectUrl(platform: SocialPlatform, userId: string): Promise<string> {
    const state = this.signState({ userId, platform, ts: Date.now() });

    switch (platform) {
      case SocialPlatform.INSTAGRAM:
        return this.instagramProvider.getAuthorizationUrl(state);
      case SocialPlatform.FACEBOOK:
        return this.facebookProvider.getAuthorizationUrl(state);
      case SocialPlatform.YOUTUBE:
        return this.youtubeProvider.getAuthorizationUrl(state);
      case SocialPlatform.X:
        return this.xProvider.getAuthorizationUrl(userId);
      case SocialPlatform.THREADS:
        return this.threadsProvider.getAuthorizationUrl(state);
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
    const stateData = this.verifyState(state);
    const { userId, platform } = stateData;

    // #38: Upfront platform validation — only Instagram & YouTube use the generic callback
    const supportedCallbackPlatforms: string[] = [SocialPlatform.INSTAGRAM, SocialPlatform.YOUTUBE];
    if (!supportedCallbackPlatforms.includes(platform as string)) {
      throw new BadRequestException(
        `Platform "${platform}" is not supported via the generic callback. Use the platform-specific callback route.`,
      );
    }

    if (platform === SocialPlatform.INSTAGRAM) {
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
    const stateData = this.verifyState(state);
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
   * Handle the Threads OAuth callback strictly isolated.
   */
  async handleThreadsCallback(
    code: string,
    state: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    const stateData = this.verifyState(state);
    const { userId, platform } = stateData;

    if (platform !== SocialPlatform.THREADS) {
      throw new BadRequestException('Expected Threads platform for this callback');
    }

    // Exchange for short token
    const { accessToken: shortToken, userId: threadsUserId } =
      await this.threadsProvider.exchangeCodeForToken(code);

    // Try to get long lived token
    let token = shortToken;
    let expiresIn = 3600;
    try {
      const longLived = await this.threadsProvider.getLongLivedToken(shortToken);
      token = longLived.accessToken;
      expiresIn = longLived.expiresIn;
      this.logger.log('Successfully obtained long-lived Threads token');
    } catch (err) {
      const errBody = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
      this.logger.warn(`Failed to get long-lived Threads token: ${errBody}`);
    }

    // Get user profile
    let profile: any = {
      id: threadsUserId,
      username: `threads_user_${threadsUserId}`,
      name: `Threads User`,
    };
    try {
      profile = await this.threadsProvider.getUserProfile(token);
    } catch (err: any) {
      const errBody = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message;
      this.logger.warn(`Failed to get Threads profile: ${errBody}`);
    }

    // Store the account
    const encryptedToken = this.encrypt(token);

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        platform: SocialPlatform.THREADS,
        accountId: profile.id,
      },
      {
        accessToken: encryptedToken,
        tokenExpiry: new Date(Date.now() + expiresIn * 1000),
        accountName: profile.username || profile.name,
        profilePicture: profile.threadsProfilePictureUrl || null,
      },
      { upsert: true, new: true },
    );

    return {
      platform: SocialPlatform.THREADS,
      accountName: profile.username || profile.name,
    };
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
          tokenExpiry: null, // Page tokens from short-to-long flow do not expire as long as user manages the page
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
   * Delete all social accounts for a specific user.
   * Used during account deletion.
   */
  async deleteByUserId(userId: string): Promise<void> {
    const result = await this.socialAccountModel.deleteMany({
      userId: new Types.ObjectId(userId),
    });
    this.logger.log(
      `Deleted ${result.deletedCount} social accounts for user ${userId}`,
    );
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
      const response = await axios.get(
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

  /**
   * Handle X (Twitter) OAuth 1.0a callback.
   * Exchanges the temporary token + verifier for permanent tokens.
   */
  async handleXCallback(
    oauthToken: string,
    oauthVerifier: string,
  ): Promise<{ platform: SocialPlatform; accountName: string }> {
    const tokenData = await this.xProvider.exchangeTokens(
      oauthToken,
      oauthVerifier,
    );

    const encryptedAccessToken = this.encrypt(tokenData.accessToken);
    const encryptedAccessSecret = this.encrypt(tokenData.accessSecret);

    await this.socialAccountModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(tokenData.userId),
        platform: SocialPlatform.X,
        accountId: tokenData.accountId,
      },
      {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedAccessSecret, // Store OAuth 1.0a secret in refreshToken field
        tokenExpiry: null, // OAuth 1.0a tokens don't expire securely
        accountName: tokenData.accountName,
        profilePicture: null,
      },
      { upsert: true, new: true },
    );

    return {
      platform: SocialPlatform.X as SocialPlatform,
      accountName: tokenData.accountName,
    };
  }

  async getAccountsForPlatforms(
    userId: string,
    platforms: SocialPlatform[],
  ): Promise<
    Array<{
      account: SocialAccountDocument;
      decryptedToken: string;
      decryptedSecret?: string;
    }>
  > {
    const accounts = await this.socialAccountModel.find({
      userId: new Types.ObjectId(userId),
      platform: { $in: platforms },
    });

    return Promise.all(
      accounts.map(async (account) => {
        // #31: Warn about expired tokens, try auto-refreshing if supported
        if (account.tokenExpiry && new Date(account.tokenExpiry) < new Date()) {
          if (account.platform === SocialPlatform.YOUTUBE && account.refreshToken) {
            try {
              const decRefresh = this.decrypt(account.refreshToken);
              const { accessToken, expiresIn } = await this.youtubeProvider.refreshAccessToken(decRefresh);

              account.accessToken = this.encrypt(accessToken);
              account.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

              await this.socialAccountModel.updateOne(
                { _id: account._id },
                { $set: { accessToken: account.accessToken, tokenExpiry: account.tokenExpiry } }
              );

              this.logger.log(`Auto-refreshed expired YouTube token for account: ${account.accountName}`);
            } catch (e: any) {
              const errorBody = e?.response?.data
                ? JSON.stringify(e.response.data)
                : e.message;
              this.logger.error(
                `Failed to auto-refresh YouTube token for ${account.accountName}: ${errorBody}`,
              );
            }
          } else {
            this.logger.warn(
              `Token for ${account.platform} account "${account.accountName}" (${account.accountId}) has expired. ` +
              `Expired at: ${account.tokenExpiry.toISOString()}. Publishing may fail.`,
            );
          }
        }

        const result: any = {
          account,
          decryptedToken: this.decrypt(account.accessToken),
        };

        if (account.refreshToken) {
          result.decryptedSecret = this.decrypt(account.refreshToken);
        }

        return result;
      })
    );
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

  /**
   * Get account analytics by platform native provider.
   */
  async getAccountAnalytics(userId: string, accountId: string): Promise<any> {
    const account = await this.socialAccountModel.findOne({
      userId: new Types.ObjectId(userId),
      _id: accountId,
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const decryptedToken = this.decrypt(account.accessToken);

    switch (account.platform) {
      case SocialPlatform.FACEBOOK:
        return this.facebookProvider.getPageInsights(decryptedToken, account.accountId);
      case SocialPlatform.INSTAGRAM:
        return this.instagramProvider.getUserInsights(account.accountId, decryptedToken);
      case SocialPlatform.THREADS:
        return this.threadsProvider.getAccountAnalytics(account.accountId, decryptedToken);
      case SocialPlatform.YOUTUBE:
        return this.youtubeProvider.getAccountAnalytics(account.accountId, decryptedToken);
      default:
        this.logger.log(`Analytics requested for unsupported platform: ${account.platform}`);
        return {};
    }
  }
}
