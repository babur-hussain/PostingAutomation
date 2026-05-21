import { IsString, IsNotEmpty } from 'class-validator';

export class VerifySubscriptionDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsString()
    @IsNotEmpty()
    purchaseToken: string;
}
