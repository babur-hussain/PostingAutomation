import { Injectable, Logger } from '@nestjs/common';
import { MessagesGateway } from '../messages/messages.gateway';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly messagesGateway: MessagesGateway) {}

  /**
   * Parse the incoming body payload from Meta API and distribute appropriately
   */
  async processMetaPayload(body: any) {
    // Meta wrapper payload: { object: 'page' | 'instagram', entry: [{ id, time, messaging: [...] }] }
    
    if (body.object === 'page' || body.object === 'instagram') {
      const entries = body.entry || [];
      
      for (const entry of entries) {
        const events = entry.messaging || [];
        
        for (const event of events) {
          if (event.message) {
            this.logger.log(`Parsed explicit message from webhook: ${JSON.stringify(event.message)}`);
            this.broadcastIncomingMessage(entry.id, event);
          }
        }
      }
    }
  }

  private broadcastIncomingMessage(accountId: string, event: any) {
    const senderId = event.sender.id;
    const recipientId = event.recipient.id;
    const messageText = event.message.text || '';
    const messageId = event.message.mid;
    
    // We emit the event through the Messages Gateway.
    // The Gateway knows which user maps to which Socket via connected devices and database lookups.
    this.messagesGateway.emitNewMessageWebhook(accountId, senderId, recipientId, messageText, messageId);
  }
}
