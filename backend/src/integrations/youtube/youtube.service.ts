import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Readable } from 'stream';

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  /**
   * Publish a video to YouTube.
   *
   * YouTube Data API v3 resumable upload:
   * 1. Download video from S3 URL
   * 2. Initiate resumable upload session
   * 3. Upload the video data
   * 4. Set snippet (title, description) and status (privacy)
   */
  async publishYouTubeVideo(
    accessToken: string,
    videoUrl: string,
    title: string,
    description: string,
    location?: { name: string; lat: number; lng: number }
  ): Promise<string> {
    if (!videoUrl) {
      throw new Error('Video URL is required for YouTube posting');
    }

    try {
      this.logger.log(`Starting YouTube upload. Title: "${title}"`);

      // 1. Download the video from S3 as a stream to avoid memory exhaustion
      const videoResponse = await axios.get(videoUrl, {
        responseType: 'stream',
      });
      
      const contentLength = videoResponse.headers['content-length'];
      const videoStream = videoResponse.data;

      if (!contentLength) {
        throw new Error('Could not determine video file size from S3 URL');
      }

      this.logger.log(`Starting video stream download: ${contentLength} bytes`);

      const metadata: any = {
        snippet: {
          title: title || 'Untitled',
          description: description || '',
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      };

      if (location) {
        metadata.recordingDetails = {
          location: {
            latitude: location.lat,
            longitude: location.lng,
          },
          locationDescription: location.name,
        };
      }

      const part = location ? 'snippet,status,recordingDetails' : 'snippet,status';

      const initiateResponse = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos',
        JSON.stringify(metadata),
        {
          params: {
            uploadType: 'resumable',
            part,
          },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': contentLength.toString(),
            'X-Upload-Content-Type': 'video/*',
          },
        },
      );

      const uploadUrl = initiateResponse.headers.location;
      if (!uploadUrl) {
        throw new Error('Failed to get YouTube upload URL');
      }

      this.logger.log('Got resumable upload URL, uploading video data...');

      // 3. Upload video data via stream
      const uploadResponse = await axios.put(uploadUrl, videoStream, {
        headers: {
          'Content-Length': contentLength.toString(),
          'Content-Type': 'video/*',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const videoId = uploadResponse.data?.id;
      if (!videoId) {
        throw new Error('YouTube upload completed but no video ID returned');
      }

      this.logger.log(`Successfully published YouTube video: ${videoId}`);
      return videoId;
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        const googleError = JSON.stringify(error.response.data);
        this.logger.error(`YouTube API Error: ${googleError}`);
        throw new Error(`YouTube API Error: ${googleError}`);
      }
      throw error;
    }
  }
}
