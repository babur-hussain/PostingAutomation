import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { PosterService } from './poster.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/poster')
@UseGuards(JwtAuthGuard)
export class PosterController {
  constructor(private readonly posterService: PosterService) {}

  @Post('generate')
  generatePoster(
    @CurrentUser('userId') userId: string,
    @Body('prompt') prompt: string,
    @Body('aspect_ratio') aspectRatio: string,
    @Body('model') model: string,
    @Body('festivalName') festivalName: string,
    @Body('festivalDate') festivalDate: string,
    @Body('image_url') imageUrl?: string,
  ) {
    return this.posterService.generatePoster(userId, prompt, aspectRatio, model, festivalName, festivalDate, imageUrl);
  }

  @Get('status')
  getTaskStatus(
    @CurrentUser('userId') userId: string,
    @Query('taskId') taskId: string,
  ) {
    return this.posterService.getTaskStatus(taskId);
  }

  @Post('save')
  savePoster(
    @CurrentUser('userId') userId: string,
    @Body('festivalName') festivalName: string,
    @Body('festivalDate') festivalDate: string,
    @Body('imageUrl') imageUrl: string,
  ) {
    return this.posterService.savePoster(userId, festivalName, festivalDate, imageUrl);
  }

  @Get('saved')
  getSavedPosters(
    @CurrentUser('userId') userId: string,
  ) {
    return this.posterService.getSavedPosters(userId);
  }
}
