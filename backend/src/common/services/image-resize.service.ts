import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import sharp = require('sharp');

/**
 * Shared image resize utility for social media publishing.
 * Ensures images comply with platform aspect ratio requirements.
 *
 * Instagram & Threads: 4:5 (0.8) to 1.91:1
 * Facebook: More lenient but we use the same range for consistency
 */
@Injectable()
export class ImageResizeService {
    private readonly logger = new Logger(ImageResizeService.name);
    private readonly s3Client: S3Client;
    private readonly bucketName: string;
    private readonly awsRegion: string;

    // Platform aspect ratio limits (Instagram/Threads standard, also good for Facebook)
    private readonly MIN_RATIO = 4 / 5;   // 0.8  (portrait)
    private readonly MAX_RATIO = 1.91;     // 1.91 (landscape)

    constructor(private configService: ConfigService) {
        this.awsRegion = this.configService.get<string>('aws.region') || 'ap-south-1';
        this.bucketName = this.configService.get<string>('aws.s3BucketName') || '';
        this.s3Client = new S3Client({
            region: this.awsRegion,
            credentials: {
                accessKeyId: this.configService.get<string>('aws.accessKeyId') || '',
                secretAccessKey: this.configService.get<string>('aws.secretAccessKey') || '',
            },
        });
    }

    /**
     * Downloads an image, checks its aspect ratio, and if it's outside
     * the allowed range (4:5 to 1.91:1), pads it with a white background
     * to fit the nearest valid ratio. Re-uploads to S3.
     *
     * @param imageUrl - Public URL of the image
     * @param platform - Platform name for logging (e.g. 'instagram', 'facebook', 'threads')
     * @returns The new S3 URL if resized, or the original URL if no resize was needed
     */
    async ensureValidAspectRatio(
        imageUrl: string,
        platform: string = 'social',
    ): Promise<string> {
        // Download the image
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const inputBuffer = Buffer.from(response.data);

        const metadata = await sharp(inputBuffer).metadata();
        const { width, height } = metadata;

        if (!width || !height) {
            this.logger.warn(`[${platform}] Could not read image dimensions, skipping resize`);
            return imageUrl;
        }

        const currentRatio = width / height;
        this.logger.log(
            `[${platform}] Image dimensions: ${width}x${height}, ratio: ${currentRatio.toFixed(3)} (allowed: ${this.MIN_RATIO.toFixed(3)}–${this.MAX_RATIO.toFixed(3)})`,
        );

        // If the ratio is within the allowed range, no processing needed
        if (currentRatio >= this.MIN_RATIO && currentRatio <= this.MAX_RATIO) {
            this.logger.log(`[${platform}] Image aspect ratio is within limits, no resize needed`);
            return imageUrl;
        }

        // Calculate the new dimensions by padding (not cropping)
        let newWidth = width;
        let newHeight = height;

        if (currentRatio < this.MIN_RATIO) {
            // Image is too tall (e.g. 9:16). Pad width to reach 4:5
            newWidth = Math.ceil(height * this.MIN_RATIO);
            newHeight = height;
            this.logger.log(`[${platform}] Image too tall. Padding width from ${width} to ${newWidth}`);
        } else {
            // Image is too wide (e.g. ultra-panoramic). Pad height to reach 1.91:1
            newWidth = width;
            newHeight = Math.ceil(width / this.MAX_RATIO);
            this.logger.log(`[${platform}] Image too wide. Padding height from ${height} to ${newHeight}`);
        }

        // Ensure dimensions don't exceed 1440px on longest side
        const maxDim = 1440;
        if (newWidth > maxDim || newHeight > maxDim) {
            const scale = maxDim / Math.max(newWidth, newHeight);
            newWidth = Math.round(newWidth * scale);
            newHeight = Math.round(newHeight * scale);
            this.logger.log(`[${platform}] Scaled down to ${newWidth}x${newHeight}`);
        }

        // Resize and pad with white background
        const processedBuffer = await sharp(inputBuffer)
            .resize(newWidth, newHeight, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .jpeg({ quality: 92 })
            .toBuffer();

        this.logger.log(`[${platform}] Resized image: ${newWidth}x${newHeight}, size: ${processedBuffer.length} bytes`);

        // Upload to S3
        const s3Key = `media/${platform}-resized/${uuidv4()}.jpg`;
        await this.s3Client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key,
                Body: processedBuffer,
                ContentType: 'image/jpeg',
            }),
        );

        const newUrl = `https://${this.bucketName}.s3.${this.awsRegion}.amazonaws.com/${s3Key}`;
        this.logger.log(`[${platform}] Uploaded resized image to S3: ${newUrl}`);
        return newUrl;
    }

    /**
     * Check if a URL points to a video file.
     */
    isVideoUrl(url: string): boolean {
        const lower = url.toLowerCase();
        return lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.avi') || lower.includes('video');
    }
}
