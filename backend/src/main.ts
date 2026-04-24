import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  // Default body parser limited to 1MB for normal routes (protects against payload DoS).
  // Media uploads are handled separately by Multer with its own 100MB limit.
  const expressApp = app.getHttpAdapter().getInstance();
  const express = require('express');
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use(express.urlencoded({ limit: '1mb', extended: true }));

  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());

  // Enable graceful shutdown hooks so BullMQ jobs can finish cleanly
  app.enableShutdownHooks();

  // CORS — allow production website and dev origins
  const allowedOrigins: string[] = [
    'https://postonce.lfvs.in',
    'https://www.postonce.lfvs.in',
  ];

  if (configService.get<string>('nodeEnv') !== 'production') {
    allowedOrigins.push('http://localhost:8081', 'http://localhost:19006', 'http://localhost:3000');
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global interceptors and filters
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger API documentation (development only)
  if (configService.get<string>('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Post Once API')
      .setDescription('Social Media Auto-Posting Platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger docs available at /api/docs');
  }

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);
  logger.log(`🚀 Application running on port ${port}`);
  logger.log(`📚 Environment: ${configService.get('nodeEnv')}`);
}

bootstrap();
