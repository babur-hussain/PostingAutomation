import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';

@Controller()
export class StaticController {
    @Get('privacy-policy')
    getPrivacyPolicy(@Res() res: Response) {
        return res.sendFile(join(__dirname, '..', '..', '..', 'public', 'privacy-policy.html'));
    }

    @Get('terms-and-conditions')
    getTerms(@Res() res: Response) {
        return res.sendFile(join(__dirname, '..', '..', '..', 'public', 'terms-and-conditions.html'));
    }

    @Get('data-deletion')
    getDataDeletion(@Res() res: Response) {
        return res.sendFile(join(__dirname, '..', '..', '..', 'public', 'data-deletion.html'));
    }
}
