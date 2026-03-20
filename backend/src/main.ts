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

  // Increase body parser limits for media uploads
  // NestJS built-in body parser handles this via the rawBody option and express settings
  const expressApp = app.getHttpAdapter().getInstance();
  const express = require('express');
  expressApp.use(express.json({ limit: '100mb' }));
  expressApp.use(express.urlencoded({ limit: '100mb', extended: true }));

  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());

  // CORS — only allow localhost in non-production
  const allowedOrigins: string[] = [
    configService.get<string>('frontendUrl'),
  ].filter(Boolean) as string[];

  if (configService.get<string>('nodeEnv') !== 'production') {
    allowedOrigins.push('http://localhost:8081', 'http://localhost:19006');
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

  // Swagger API documentation
  if (configService.get<string>('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('PostingAutomation API')
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
