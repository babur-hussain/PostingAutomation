import { Controller, Get, Post, Req, Res, Logger, Query, Body, HttpStatus, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';

@SkipThrottle()
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
   * Payload receiver for Meta Webhooks.
   * Verifies the X-Hub-Signature-256 header to ensure the payload came from Meta.
   */
  @Post('meta')
  handleWebhook(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    // Verify X-Hub-Signature-256 header
    const signature = req.headers['x-hub-signature-256'] as string;
    const appSecret = this.configService.get<string>('meta.appSecret');

    if (appSecret && signature) {
      const rawBody = JSON.stringify(body);
      const expectedSig = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');

      if (signature !== expectedSig) {
        this.logger.warn('Invalid X-Hub-Signature-256 on Meta webhook — rejecting payload');
        return res.sendStatus(HttpStatus.FORBIDDEN);
      }
    } else if (appSecret && !signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header on Meta webhook — rejecting payload');
      return res.sendStatus(HttpStatus.FORBIDDEN);
    }

    this.logger.log(`Received verified Meta webhook payload`);

    this.webhooksService.processMetaPayload(body).catch((err) => {
      this.logger.error(`Error processing webhook payload: ${err.message}`);
    });

    // We must always respond with 200 OK immediately so Meta doesn't block the endpoint
    return res.status(HttpStatus.OK).send('EVENT_RECEIVED');
  }
}
