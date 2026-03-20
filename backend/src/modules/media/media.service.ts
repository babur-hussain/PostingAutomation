import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { Media, MediaDocument } from './schemas/media.schema';

// Allowed MIME types for media uploads
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime', // .mov
]);

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly uploadsDir: string;
  private readonly publicBaseUrl: string;

  constructor(
    @InjectModel(Media.name) private mediaModel: Model<MediaDocument>,
    private configService: ConfigService,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('aws.region') || 'us-east-1',
      credentials: {
        accessKeyId: this.configService.get<string>('aws.accessKeyId') || '',
        secretAccessKey:
          this.configService.get<string>('aws.secretAccessKey') || '',
      },
    });
    this.bucketName = this.configService.get<string>('aws.s3BucketName') || '';

    // Local uploads fallback directory
    this.uploadsDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'public',
      'uploads',
    );
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    // Public base URL for accessing uploaded files
    const appUrl =
      this.configService.get<string>('APP_URL') ||
      'https://postingautomation.lfvs.in';
    this.publicBaseUrl = appUrl;
  }

  /**
   * Upload a file. Tries S3 first, falls back to local disk storage.
   * Validates file MIME type against the allowlist before uploading.
   */
  async upload(
    userId: string,
    file: Express.Multer.File,
  ): Promise<MediaDocument> {
    // #10: Validate file type against allowlist
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. ` +
        `Accepted types: JPEG, PNG, GIF, WebP, MP4, MOV.`,
      );
    }

    const ext = file.originalname.split('.').pop();
    const uniqueName = `${uuidv4()}.${ext}`;

    // Try S3 first
    try {
      const s3Key = `media/${userId}/${uniqueName}`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      const s3Url = `https://${this.bucketName}.s3.${this.configService.get('aws.region')}.amazonaws.com/${s3Key}`;
      this.logger.log(`Uploaded to S3: ${s3Url}`);

      const media = new this.mediaModel({
        userId: new Types.ObjectId(userId),
        s3Key,
        s3Url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalName: file.originalname,
      });

      return media.save();
    } catch (s3Error) {
      this.logger.warn(
        `S3 upload failed (${s3Error.message}), falling back to local storage`,
      );
    }

    // Fallback: save to local public/uploads/ directory
    const localPath = path.join(this.uploadsDir, uniqueName);
    fs.writeFileSync(localPath, file.buffer);

    const publicUrl = `${this.publicBaseUrl}/public/uploads/${uniqueName}`;
    this.logger.log(`Saved locally: ${publicUrl}`);

    const media = new this.mediaModel({
      userId: new Types.ObjectId(userId),
      s3Key: `local/${uniqueName}`,
      s3Url: publicUrl,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      originalName: file.originalname,
    });

    return media.save();
  }

  /**
   * Get a presigned URL for direct access to the media.
   */
  async getPresignedUrl(s3Key: string): Promise<string> {
    // If it's a local file, just return the public URL
    if (s3Key.startsWith('local/')) {
      const filename = s3Key.replace('local/', '');
      return `${this.publicBaseUrl}/public/uploads/${filename}`;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: 3600, // 1 hour
    });
  }

  /**
   * Get a media record by ID.
   */
  async findById(
    mediaId: string,
    userId: string,
  ): Promise<MediaDocument | null> {
    return this.mediaModel.findOne({
      _id: mediaId,
      userId: new Types.ObjectId(userId),
    });
  }

  /**
   * Delete a media file from S3/local and the database.
   */
  async delete(mediaId: string, userId: string): Promise<void> {
    const media = await this.mediaModel.findOne({
      _id: mediaId,
      userId: new Types.ObjectId(userId),
    });

    if (media) {
      if (media.s3Key.startsWith('local/')) {
        // Delete local file
        const filename = media.s3Key.replace('local/', '');
        const localPath = path.join(this.uploadsDir, filename);
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      } else {
        // Delete from S3
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: media.s3Key,
          }),
        );
      }
      await this.mediaModel.deleteOne({ _id: mediaId });
    }
  }
}
