import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { MediaService } from '../media/media.service';
import { GeneratedPoster, GeneratedPosterDocument } from './schemas/generated-poster.schema';
import { PendingPosterTask, PendingPosterTaskDocument } from './schemas/pending-poster-task.schema';

@Injectable()
export class PosterService {
  private readonly kieApiBaseUrl = 'https://api.kie.ai';
  private readonly logger = new Logger(PosterService.name);

  constructor(
    private configService: ConfigService,
    private mediaService: MediaService,
    @InjectModel(GeneratedPoster.name) private generatedPosterModel: Model<GeneratedPosterDocument>,
    @InjectModel(PendingPosterTask.name) private pendingPosterTaskModel: Model<PendingPosterTaskDocument>,
  ) {}

  private getAuthHeaders() {
    const apiKey = this.configService.get<string>('kieAi.apiKey');
    if (!apiKey) {
      throw new HttpException('KIE AI API key is not configured on the server', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async generatePoster(userId: string, prompt: string, aspectRatio: string, model: string, festivalName: string, festivalDate: string, imageUrl?: string) {
    try {
      const payload: any = {
        model: model,
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          resolution: '1K',
        },
      };

      if (imageUrl && model === 'gpt-image-2-image-to-image') {
        payload.input.image_url = imageUrl;
      }

      const response = await axios.post(`${this.kieApiBaseUrl}/api/v1/jobs/createTask`, payload, {
        headers: this.getAuthHeaders(),
      });

      const taskId = response.data?.data?.taskId || response.data?.taskId;
      if (!taskId) {
        throw new HttpException('No taskId returned from KIE AI', HttpStatus.BAD_GATEWAY);
      }

      await this.pendingPosterTaskModel.create({
        userId,
        taskId,
        festivalName,
        festivalDate,
        status: 'waiting',
      });

      return { taskId, status: 'waiting' };
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message || 'Failed to generate poster',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTaskStatus(taskId: string) {
    try {
      const response = await axios.get(`${this.kieApiBaseUrl}/api/v1/jobs/recordInfo`, {
        params: { taskId },
        headers: this.getAuthHeaders(),
      });

      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message || 'Failed to check task status',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async savePoster(userId: string, festivalName: string, festivalDate: string, imageUrl: string) {
    try {
      // 1. Download image from KIE AI url
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');

      // 2. Create mock Multer file for mediaService
      const file: Express.Multer.File = {
        fieldname: 'file',
        originalname: `${festivalName.replace(/[^a-zA-Z0-9]/g, '_')}_poster.jpg`,
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer,
        size: buffer.length,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      // 3. Upload to S3
      const media = await this.mediaService.upload(userId, file);

      // 4. Upsert GeneratedPoster record
      const poster = await this.generatedPosterModel.findOneAndUpdate(
        { userId, festivalName },
        {
          userId,
          festivalName,
          festivalDate,
          s3Url: media.s3Url,
        },
        { new: true, upsert: true },
      );

      return poster;
    } catch (error: any) {
      throw new HttpException(
        'Failed to save generated poster to S3',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getSavedPosters(userId: string) {
    return this.generatedPosterModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  @Cron('*/15 * * * * *') // Run every 15 seconds
  async pollPendingTasks() {
    try {
      const pendingTasks = await this.pendingPosterTaskModel.find({ status: 'waiting' });
      
      for (const task of pendingTasks) {
        try {
          const statusRes = await this.getTaskStatus(task.taskId);
          const data = statusRes.data || statusRes;
          const status = data?.status || data?.state || 'waiting';

          if (status === 'success') {
            const resultJson = data?.resultJson
              ? typeof data.resultJson === 'string'
                ? JSON.parse(data.resultJson)
                : data.resultJson
              : null;
            
            const resultUrl =
              resultJson?.resultUrls?.[0] ||
              resultJson?.output?.image_url ||
              data?.resultUrls?.[0] ||
              data?.output?.image_url ||
              data?.resultUrl;

            if (resultUrl) {
              await this.savePoster(task.userId.toString(), task.festivalName, task.festivalDate, resultUrl);
              await this.pendingPosterTaskModel.deleteOne({ _id: task._id });
              this.logger.log(`Successfully processed and saved poster for task ${task.taskId}`);
            } else {
              this.logger.error(`Task ${task.taskId} succeeded but no image URL found`);
              await this.pendingPosterTaskModel.deleteOne({ _id: task._id });
            }
          } else if (status === 'fail' || status === 'failed') {
            await this.pendingPosterTaskModel.deleteOne({ _id: task._id });
            this.logger.error(`Poster generation failed for task ${task.taskId}`);
          }
        } catch (error) {
          this.logger.error(`Error polling task ${task.taskId}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch pending tasks: ${error.message}`);
    }
  }
}
