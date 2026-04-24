import { Injectable, ConflictException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EarlyAccess, EarlyAccessDocument } from './schemas/early-access.schema';
import { CreateEarlyAccessDto } from './dto/create-early-access.dto';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EarlyAccessService implements OnModuleInit {
    private readonly logger = new Logger(EarlyAccessService.name);
    // User's provided Google Sheet for Early Access
    private readonly SHEET_ID = '1VAOBIiZskf32Nl-iLwVKlp3IbWcS_6cmECxJkvEjfdY';
    private readonly SYNC_INTERVAL_MS = 60_000; // 60s

    constructor(
        @InjectModel(EarlyAccess.name) private earlyAccessModel: Model<EarlyAccessDocument>,
        private configService: ConfigService,
    ) { }

    onModuleInit() {
        this.logger.log('Starting early access status sync from Google Sheets (every 60s)...');
        this.syncAllStatusesFromSheets();
        setInterval(() => this.syncAllStatusesFromSheets(), this.SYNC_INTERVAL_MS);
    }

    async create(dto: CreateEarlyAccessDto) {
        // Prevent duplicate emails
        const emailLower = dto.email.trim().toLowerCase();
        const existing = await this.earlyAccessModel.findOne({ email: emailLower });
        if (existing) {
            throw new ConflictException('This email is already registered for early access.');
        }

        // Save to DB
        const request = await this.earlyAccessModel.create({
            name: dto.name,
            email: emailLower,
            mobile: dto.mobile,
            status: 'pending',
        });

        // Sync out (fire & forget)
        this.syncToGoogleSheets(request).catch(err => {
            this.logger.error(`Failed to sync to Google Sheets for email ${emailLower}`, err);
        });

        return { success: true, message: 'Early access request submitted successfully.' };
    }

    async checkApprovalStatus(email: string) {
        if (!email) {
            return { approved: false, status: 'none' };
        }

        const emailLower = email.trim().toLowerCase();
        const existing = await this.earlyAccessModel.findOne({ email: emailLower });

        if (!existing) {
            return { approved: false, status: 'none' };
        }

        const isApproved = existing.status === 'approved';
        return {
            approved: isApproved,
            status: existing.status
        };
    }

    private async getGoogleSheet(): Promise<GoogleSpreadsheet | null> {
        const email = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        const privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');

        if (!email || !privateKey) {
            this.logger.warn('Google Credentials not found. Cannot sync early access sheets.');
            return null;
        }

        const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

        const serviceAccountAuth = new JWT({
            email,
            key: formattedPrivateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(this.SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        return doc;
    }

    private async syncToGoogleSheets(data: EarlyAccessDocument) {
        try {
            const doc = await this.getGoogleSheet();
            if (!doc) return;

            const sheet = doc.sheetsByIndex[0];

            // Add the row matching the exact headers the user expects
            await sheet.addRow({
                Name: data.name,
                Email: data.email,
                Mobile: data.mobile,
                Timestamp: new Date().toISOString(),
                Status: 'pending',
            });

            this.logger.log(`Successfully appended early access row for ${data.email}`);
        } catch (error) {
            this.logger.error('Error in syncToGoogleSheets', error);
        }
    }

    private async syncAllStatusesFromSheets(): Promise<void> {
        try {
            // Get all pending early access requests from MongoDB
            const pendingRequests = await this.earlyAccessModel.find({
                status: 'pending'
            });

            if (pendingRequests.length === 0) return;

            // Map emails to handle lookups easily
            const pendingEmails = new Set(pendingRequests.map(r => r.email));

            // Read Google Sheet
            const doc = await this.getGoogleSheet();
            if (!doc) return;

            const sheet = doc.sheetsByIndex[0];
            const rows = await sheet.getRows();

            let approvedCount = 0;
            for (const row of rows) {
                const rowEmail = (row.get('Email') || '').trim().toLowerCase();
                const rowStatus = (row.get('Status') || '').trim().toLowerCase();

                // If sheet says approved, and Mongo still has it as pending
                if (rowStatus === 'approved' && pendingEmails.has(rowEmail)) {
                    await this.earlyAccessModel.updateOne(
                        { email: rowEmail },
                        { $set: { status: 'approved' } }
                    );
                    approvedCount++;
                    this.logger.log(`[EarlyAccess Sync] Approved: ${rowEmail}`);
                }
            }

            if (approvedCount > 0) {
                this.logger.log(`[EarlyAccess Sync] Updated ${approvedCount} approvals from Google Sheets`);
            }
        } catch (error) {
            this.logger.error('[EarlyAccess Sync] Error syncing:', error?.message || error);
        }
    }
}
