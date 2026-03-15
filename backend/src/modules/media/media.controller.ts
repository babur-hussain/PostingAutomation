import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/v1/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser('userId') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }), // 100MB
          new FileTypeValidator({
            fileType:
              /(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo))/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.mediaService.upload(userId, file);
  }

  @Get(':id')
  async getMedia(
    @CurrentUser('userId') userId: string,
    @Param('id') mediaId: string,
  ) {
    return this.mediaService.findById(mediaId, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMedia(
    @CurrentUser('userId') userId: string,
    @Param('id') mediaId: string,
  ) {
    await this.mediaService.delete(mediaId, userId);
    return { message: 'Media deleted successfully' };
  }
}
