import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  MaxLength,
  ValidateNested,
  IsNumber,
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
  mediaUrl?: string;

  @IsArray()
  @IsEnum(PostPlatform, { each: true })
  platforms: PostPlatform[];

  @IsOptional()
  @IsDateString()
  scheduledTime?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}
