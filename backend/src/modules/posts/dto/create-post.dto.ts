import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  MaxLength,
  ValidateNested,
  IsNumber,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PostPlatform } from '../schemas/post.schema';

export class LocationDto {
  @IsString()
  name: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}


export class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsArray()
  @IsEnum(PostPlatform, { each: true })
  @ArrayMaxSize(5, { message: 'Cannot publish to more than 5 platforms at once' })
  @ArrayUnique({ message: 'Duplicate platforms are not allowed' })
  platforms: PostPlatform[];

  @IsOptional()
  @IsDateString()
  scheduledTime?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}
