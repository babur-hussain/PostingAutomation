import { IsString, IsOptional, IsArray, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { PostPlatform } from '../schemas/post.schema';

export class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsArray()
  @IsEnum(PostPlatform, { each: true })
  platforms: PostPlatform[];

  @IsOptional()
  @IsDateString()
  scheduledTime?: string;
}
