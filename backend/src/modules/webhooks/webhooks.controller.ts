import { Controller, Get, Post, Req, Res, Logger, Query, Body, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('api/v1/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly webhooksService: WebhooksService,
  ) {}

  /**
   * Meta Webhook Verification Endpoint
   * Respond to Meta's hub.challenge exactly if hub.verify_token matches our ENVs.
   */
  @Get('meta')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response
  ) {
    const verifyToken = this.configService.get<string>('meta.webhookVerifyToken');
    
    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        this.logger.log('WEBHOOK_VERIFIED');
        // Must return ONLY the challenge value with an HTTP 200 explicitly
        return res.status(HttpStatus.OK).send(challenge);
      } else {
        // Must return 403 Forbidden if token mismatch
        return res.sendStatus(HttpStatus.FORBIDDEN);
      }
    }
    
    return res.sendStatus(HttpStatus.BAD_REQUEST);
  }

  /**
   * Payload receiver for Meta Webhooks
   */
  @Post('meta')
  handleWebhook(@Body() body: any, @Res() res: Response) {
    this.logger.log(`Received Meta webhook payload: ${JSON.stringify(body)}`);

    this.webhooksService.processMetaPayload(body).catch((err) => {
      this.logger.error(`Error processing webhook payload: ${err.message}`);
    });

    // We must always response with 200 OK immediately so Meta doesn't block the endpoint
    return res.status(HttpStatus.OK).send('EVENT_RECEIVED');
  }
}
