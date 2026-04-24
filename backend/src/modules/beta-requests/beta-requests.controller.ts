import { Controller, Post, Get, Body, UseGuards, Patch, Query } from '@nestjs/common';
import { BetaRequestsService } from './beta-requests.service';
import { CreateBetaRequestDto } from './dto/create-beta-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/beta-requests')
export class BetaRequestsController {
    constructor(private readonly betaRequestsService: BetaRequestsService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    create(
        @CurrentUser('userId') userId: string,
        @Body() createBetaRequestDto: CreateBetaRequestDto,
    ) {
        return this.betaRequestsService.create(userId, createBetaRequestDto);
    }

    @Get('status')
    @UseGuards(JwtAuthGuard)
    checkStatus(@CurrentUser('userId') userId: string) {
        return this.betaRequestsService.checkBetaStatus(userId);
    }

    /**
     * Admin endpoint to approve a beta user by email.
     * Usage: POST /api/v1/beta-requests/approve
     * Body: { "email": "user@example.com", "adminSecret": "postonce-admin-2026" }
     */
    @Post('approve')
    approve(@Body() body: { email: string; adminSecret: string }) {
        return this.betaRequestsService.approveByEmail(body.email, body.adminSecret);
    }
}
