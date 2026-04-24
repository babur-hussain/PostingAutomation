import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { EarlyAccessService } from './early-access.service';
import { CreateEarlyAccessDto } from './dto/create-early-access.dto';

@Controller('api/v1/early-access')
export class EarlyAccessController {
    constructor(private readonly earlyAccessService: EarlyAccessService) { }

    @Post()
    create(@Body() createEarlyAccessDto: CreateEarlyAccessDto) {
        return this.earlyAccessService.create(createEarlyAccessDto);
    }

    @Get('status')
    checkStatus(@Query('email') email: string) {
        return this.earlyAccessService.checkApprovalStatus(email);
    }
}
