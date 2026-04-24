import { IsString, IsEmail, IsNotEmpty } from 'class-validator';

export class CreateEarlyAccessDto {
    @IsNotEmpty()
    @IsString()
    name: string;

    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsString()
    mobile: string;
}
