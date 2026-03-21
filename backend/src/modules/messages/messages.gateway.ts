import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('registerAccount')
  handleRegisterAccount(@MessageBody() accountId: string, @ConnectedSocket() client: Socket) {
    this.logger.log(`Client ${client.id} registered for account ${accountId}`);
    client.join(`account-${accountId}`);
    return { status: 'success', accountId };
  }

  /**
   * Called by WebhooksService when a new message payload arrives from Meta
   */
  emitNewMessageWebhook(accountId: string, senderId: string, recipientId: string, text: string, messageId: string) {
    this.logger.log(`Emitting newMessage to room account-${accountId} (sender: ${senderId}, text: ${text})`);
    this.server.to(`account-${accountId}`).emit('newMessage', {
      accountId,
      senderId,
      recipientId,
      text,
      messageId,
      timestamp: new Date().toISOString(),
    });
  }
}
