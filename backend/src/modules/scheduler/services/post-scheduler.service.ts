import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class PostSchedulerService {
  private readonly logger = new Logger(PostSchedulerService.name);

  constructor(@InjectQueue('posts') private postsQueue: Queue) { }

  async schedulePost(postId: string, scheduledTime: Date): Promise<string> {
    const delay = scheduledTime.getTime() - Date.now();

    if (delay < 0) {
      throw new Error('Cannot schedule post in the past');
    }

    const job = await this.postsQueue.add(
      'publish-post',
      { postId },
      {
        delay,
        jobId: `post-${postId}`, // Unique job ID allows easy cancellation
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );

    this.logger.log(`Scheduled post ${postId} for ${scheduledTime.toISOString()} (${job.id})`);
    return job.id as string;
  }

  async publishPostNow(postId: string): Promise<string> {
    const job = await this.postsQueue.add(
      'publish-post',
      { postId },
      {
        jobId: `post-${postId}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );

    this.logger.log(`Enqueued post ${postId} for immediate publishing (${job.id})`);
    return job.id as string;
  }

  async cancelJob(postId: string): Promise<void> {
    const job = await this.postsQueue.getJob(`post-${postId}`);
    if (job) {
      await job.remove();
      this.logger.log(`Cancelled scheduled job for post ${postId}`);
    }
  }
}
