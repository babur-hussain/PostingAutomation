import { IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateBetaRequestDto {
    @IsOptional()
    @IsString()
    @IsUrl()
    instagramUrl?: string;

    @IsOptional()
    @IsString()
    @IsUrl()
    facebookUrl?: string;

    @IsOptional()
    @IsString()
    @IsUrl()
    threadsUrl?: string;
}
