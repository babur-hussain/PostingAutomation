import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SocialAccountsService } from '../social-accounts/social-accounts.service';
import { SocialPlatform } from '../social-accounts/schemas/social-account.schema';

const GRAPH_API_VERSION = 'v22.0';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly socialAccountsService: SocialAccountsService) {}

  async getConversations(userId: string, filterPlatform?: string) {
    let platformsToFetch = [SocialPlatform.FACEBOOK, SocialPlatform.INSTAGRAM];
    if (filterPlatform === 'facebook') platformsToFetch = [SocialPlatform.FACEBOOK];
    if (filterPlatform === 'instagram') platformsToFetch = [SocialPlatform.INSTAGRAM];
    if (filterPlatform === 'threads') platformsToFetch = [];

    const connectedAccounts = await this.socialAccountsService.getAccountsForPlatforms(userId, platformsToFetch);
    const allConversations: any[] = [];
    let hasError = false;
    let lastErrorMsg = '';

    for (const { account, decryptedToken } of connectedAccounts) {
      try {
        const platformQuery = account.platform === SocialPlatform.INSTAGRAM ? 'instagram' : 'messenger';
        const baseUrl = account.platform === SocialPlatform.INSTAGRAM ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
        
        // Fetch conversations
        const res = await axios.get(`${baseUrl}/${GRAPH_API_VERSION}/${account.accountId}/conversations`, {
          params: {
            platform: platformQuery,
            access_token: decryptedToken,
            fields: 'id,updated_time,unread_count,participants,messages.limit(1){message,created_time,from,to}',
          }
        });

        const threads = res.data?.data || [];
        for (const thread of threads) {
          const participants = thread.participants?.data || [];
          const otherUser = participants.find(p => p.id !== account.accountId) || participants[0];
          const lastMsg = thread.messages?.data?.[0];

          allConversations.push({
            id: thread.id,
            platform: account.platform,
            accountId: account.accountId,
            recipientId: otherUser?.id,
            userName: otherUser?.name || 'Unknown User',
            userAvatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(otherUser?.name || 'User')}&background=random`,
            lastMessage: lastMsg?.message || '',
            unreadCount: thread.unread_count || 0,
            timestamp: thread.updated_time || new Date().toISOString(),
          });
        }
      } catch (error: any) {
        hasError = true;
        lastErrorMsg = error?.response?.data?.error?.message || error.message;
        this.logger.error(`Error fetching conversations for ${account.platform} account ${account.accountId}: ${lastErrorMsg}`);
      }
    }

    if (hasError && allConversations.length === 0) {
      throw new Error(`Meta API Error: ${lastErrorMsg}. Please reconnect your account to grant messaging permissions.`);
    }

    // Sort all by timestamp descending
    return allConversations.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async getConversationMessages(userId: string, platform: string, accountId: string, conversationId: string) {
    const connectedAccounts = await this.socialAccountsService.getAccountsForPlatforms(userId, [platform as SocialPlatform]);
    const accountInfo = connectedAccounts.find(a => a.account.accountId === accountId);
    if (!accountInfo) throw new Error(`Account ${accountId} not connected or found.`);

    const baseUrl = accountInfo.account.platform === SocialPlatform.INSTAGRAM ? 'https://graph.instagram.com' : 'https://graph.facebook.com';

    const res = await axios.get(`${baseUrl}/${GRAPH_API_VERSION}/${conversationId}`, {
      params: {
        fields: 'messages{id,message,created_time,from,to}',
        access_token: accountInfo.decryptedToken,
      }
    });

    const messagesRaw = res.data?.messages?.data || [];
    
    // Reverse to show oldest first, or newest bottom. The API returns newest first usually.
    return messagesRaw.reverse().map(m => ({
      id: m.id,
      text: m.message || '',
      sender: m.from?.id === accountId ? 'me' : 'them',
      timestamp: m.created_time || new Date().toISOString()
    }));
  }

  async sendMessage(userId: string, platform: string, accountId: string, recipientId: string, text: string) {
    const connectedAccounts = await this.socialAccountsService.getAccountsForPlatforms(userId, [platform as SocialPlatform]);
    const accountInfo = connectedAccounts.find(a => a.account.accountId === accountId);
    if (!accountInfo) throw new Error(`Account ${accountId} not connected or found.`);

    const baseUrl = accountInfo.account.platform === SocialPlatform.INSTAGRAM ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
    const url = `${baseUrl}/${GRAPH_API_VERSION}/${accountId}/messages`;

    const payload = {
      recipient: { id: recipientId },
      message: { text }
    };

    const res = await axios.post(url, payload, {
      params: { access_token: accountInfo.decryptedToken }
    });

    return {
      id: res.data.message_id || `temp-${Date.now()}`,
      text,
      sender: 'me',
      timestamp: new Date().toISOString(),
    };
  }
}
