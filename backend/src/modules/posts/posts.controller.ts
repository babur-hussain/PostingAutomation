import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/v1/posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) { }

  @Post()
  create(
    @CurrentUser('userId') userId: string,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.create(userId, createPostDto);
  }

  @Get()
  findAll(
    @CurrentUser('userId') userId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.postsService.findAll(userId, pagination.page);
  }

  @Get(':id')
  findOne(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.findOne(userId, id);
  }

  @Get(':id/analytics')
  getAnalytics(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.getPostAnalytics(userId, id);
  }

  @Get(':id/analytics/facebook')
  getFacebookAnalytics(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.getFacebookAnalytics(userId, id);
  }

  @Get(':id/analytics/instagram')
  getInstagramAnalytics(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.getInstagramAnalytics(userId, id);
  }

  @Delete(':id/facebook')
  deleteFacebookPost(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.deleteFacebookPost(userId, id);
  }

  @Delete(':id/instagram')
  deleteInstagramPost(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.deleteInstagramPost(userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.postsService.remove(userId, id);
  }
}
