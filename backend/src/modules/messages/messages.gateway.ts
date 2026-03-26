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
import { Logger, Injectable } from '@nestjs/common';
import { FirebaseService } from '../auth/firebase.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(private firebaseService: FirebaseService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) {
      this.logger.warn(`Client ${client.id} missing auth token. Disconnecting.`);
      client.disconnect();
      return;
    }

    try {
      const auth = this.firebaseService.getAuth();
      await auth.verifyIdToken(token);
      this.logger.log(`Client authenticated & connected: ${client.id}`);
    } catch (err) {
      this.logger.warn(`Invalid WebSocket auth token. Disconnecting client ${client.id}`);
      client.disconnect();
    }
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
