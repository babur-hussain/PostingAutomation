import { Controller, Get, Post, Body, Req, UseGuards, Query, Param, HttpException, HttpStatus } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

@Controller('api/v1/messages')
@UseGuards(FirebaseAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversations')
  async getConversations(@Req() req, @Query('platform') platform?: string) {
    try {
      const data = await this.messagesService.getConversations(req.user.uid, platform);
      return data;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('conversations/:platform/:accountId/:conversationId')
  async getConversationMessages(
    @Req() req,
    @Param('platform') platform: string,
    @Param('accountId') accountId: string,
    @Param('conversationId') conversationId: string,
  ) {
    try {
      const data = await this.messagesService.getConversationMessages(req.user.uid, platform, accountId, conversationId);
      return data;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('conversations/:platform/:accountId/:conversationId/send')
  async sendMessage(
    @Req() req,
    @Param('platform') platform: string,
    @Param('accountId') accountId: string,
    @Param('conversationId') conversationId: string, // Not used strictly by Graph API for sending, but good for context
    @Body('text') text: string,
    @Body('recipientId') recipientId: string,
  ) {
    try {
      const data = await this.messagesService.sendMessage(req.user.uid, platform, accountId, recipientId, text);
      return data;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
