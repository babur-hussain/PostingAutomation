import { Injectable, ConflictException, ForbiddenException, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BetaRequest, BetaRequestDocument } from './schemas/beta-request.schema';
import { CreateBetaRequestDto } from './dto/create-beta-request.dto';
import { UsersService } from '../users/users.service';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BetaRequestsService implements OnModuleInit {
    private readonly logger = new Logger(BetaRequestsService.name);
    private readonly BETA_LIMIT = 110;
    private readonly SHEET_ID = '1ND4Ue7SpraKHagQV127wBpxDXQjLUPq13uRjO2XPwo8';
    private readonly ADMIN_SECRET = 'postonce-admin-2026';
    private readonly SYNC_INTERVAL_MS = 60_000; // Sync from Sheets every 60 seconds

    constructor(
        @InjectModel(BetaRequest.name) private betaRequestModel: Model<BetaRequestDocument>,
        private usersService: UsersService,
        private configService: ConfigService,
    ) { }

    /**
     * Start a background job that syncs approval status from Google Sheets to MongoDB
     * every 60 seconds. This way admins just update the Sheet and it auto-syncs.
     */
    onModuleInit() {
        this.logger.log('Starting beta status sync from Google Sheets (every 60s)...');
        // Run immediately on startup, then every 60 seconds
        this.syncAllStatusesFromSheets();
        setInterval(() => this.syncAllStatusesFromSheets(), this.SYNC_INTERVAL_MS);
    }

    async create(userId: string, createBetaRequestDto: CreateBetaRequestDto) {
        // Check total limit
        const totalRequests = await this.betaRequestModel.countDocuments();
        if (totalRequests >= this.BETA_LIMIT) {
            throw new ForbiddenException(
                'Thank you for your interest in beta preview of the app right now we are full of capacity soon we will be adding more slots...'
            );
        }

        // Check duplicate
        const existing = await this.betaRequestModel.findOne({ userId: new Types.ObjectId(userId) });
        if (existing) {
            throw new ConflictException('You have already submitted a request for the beta access.');
        }

        // Save to MongoDB with status 'pending'
        const betaRequest = await this.betaRequestModel.create({
            userId: new Types.ObjectId(userId),
            ...createBetaRequestDto,
            status: 'pending',
        });

        // Fire and forget google sheets sync (write new row)
        this.syncToGoogleSheets(userId, createBetaRequestDto).catch(err => {
            this.logger.error(`Failed to sync beta request to Google Sheets for user ${userId}`, err);
        });

        return betaRequest;
    }

    /**
     * Check the beta approval status for a user.
     * Reads directly from MongoDB — fast, reliable, no external dependencies.
     */
    async checkBetaStatus(userId: string): Promise<{ status: 'none' | 'pending' | 'approved', threadsUrl?: string, instagramUrl?: string, facebookUrl?: string }> {
        const existing = await this.betaRequestModel.findOne({ userId: new Types.ObjectId(userId) });
        if (!existing) {
            return { status: 'none' };
        }

        // Handle old documents that don't have the status field yet
        const status = existing.status || 'pending';

        // Backfill if missing
        if (!existing.status) {
            await this.betaRequestModel.updateOne(
                { _id: existing._id },
                { $set: { status: 'pending' } },
            );
        }

        return { 
            status: status as 'pending' | 'approved',
            threadsUrl: existing.threadsUrl,
            instagramUrl: existing.instagramUrl,
            facebookUrl: existing.facebookUrl
        };
    }

    /**
     * Admin: Approve a beta user by email. Directly updates MongoDB.
     */
    async approveByEmail(email: string, adminSecret: string): Promise<{ success: boolean; message: string }> {
        if (adminSecret !== this.ADMIN_SECRET) {
            throw new ForbiddenException('Invalid admin secret');
        }

        if (!email) {
            throw new BadRequestException('Email is required');
        }

        const user = await this.usersService.findByEmail(email);
        if (!user) {
            throw new NotFoundException(`No user found with email: ${email}`);
        }

        const result = await this.betaRequestModel.findOneAndUpdate(
            { userId: user._id },
            { $set: { status: 'approved' } },
            { new: true },
        );

        if (!result) {
            throw new NotFoundException(`No beta request found for user: ${email}`);
        }

        this.logger.log(`Admin approved beta for user: ${email}`);
        return { success: true, message: `Beta approved for ${email}` };
    }

    /**
     * Background job: Sync ALL pending beta request statuses from Google Sheets to MongoDB.
     * Reads the sheet, finds all rows marked "approved", and updates matching MongoDB documents.
     * Runs every 60 seconds automatically.
     */
    private async syncAllStatusesFromSheets(): Promise<void> {
        try {
            // Get all pending beta requests from MongoDB
            const pendingRequests = await this.betaRequestModel.find({
                $or: [
                    { status: 'pending' },
                    { status: { $exists: false } },
                    { status: null },
                ],
            });

            if (pendingRequests.length === 0) {
                return; // No pending requests to sync
            }

            // Get all user emails for pending requests
            const userIds = pendingRequests.map(r => r.userId);
            const users = await Promise.all(
                userIds.map(uid => this.usersService.findById(uid.toString()))
            );

            // Build email-to-userId map
            const emailToUserId = new Map<string, Types.ObjectId>();
            users.forEach((user, i) => {
                if (user?.email) {
                    emailToUserId.set(user.email.toLowerCase(), userIds[i]);
                }
            });

            if (emailToUserId.size === 0) {
                return;
            }

            // Read Google Sheet
            const doc = await this.getGoogleSheet();
            if (!doc) return;

            const sheet = doc.sheetsByIndex[0];
            const rows = await sheet.getRows();

            // Find rows that are approved in sheets but pending in MongoDB
            let approvedCount = 0;
            for (const row of rows) {
                const rowEmail = (row.get('Email') || '').trim().toLowerCase();
                const rowStatus = (row.get('Status') || '').trim().toLowerCase();

                if (rowStatus === 'approved' && emailToUserId.has(rowEmail)) {
                    const userId = emailToUserId.get(rowEmail);
                    await this.betaRequestModel.updateOne(
                        { userId },
                        { $set: { status: 'approved' } },
                    );
                    approvedCount++;
                    this.logger.log(`[SheetSync] Approved beta for: ${rowEmail}`);
                }
            }

            if (approvedCount > 0) {
                this.logger.log(`[SheetSync] Synced ${approvedCount} approvals from Google Sheets`);
            }
        } catch (error) {
            this.logger.error('[SheetSync] Error syncing statuses from Google Sheets:', error?.message || error);
        }
    }

    /**
     * Helper to get an authenticated GoogleSpreadsheet instance.
     */
    private async getGoogleSheet(): Promise<GoogleSpreadsheet | null> {
        const email = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        const privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');

        if (!email || !privateKey) {
            this.logger.warn('Google Service Account credentials not provided.');
            return null;
        }

        const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

        const serviceAccountAuth = new JWT({
            email: email,
            key: formattedPrivateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(this.SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        return doc;
    }

    private async syncToGoogleSheets(userId: string, data: CreateBetaRequestDto) {
        const user = await this.usersService.findById(userId);
        if (!user) return;

        try {
            const doc = await this.getGoogleSheet();
            if (!doc) {
                this.logger.warn('Skipping Google Sheets sync — no credentials.');
                return;
            }

            const sheet = doc.sheetsByIndex[0];

            await sheet.addRow({
                Name: user.name || 'Unknown',
                Email: user.email || 'Unknown',
                'Instagram Profile': data.instagramUrl || '',
                'Facebook Profile': data.facebookUrl || '',
                'Threads Profile': data.threadsUrl || '',
                Date: new Date().toISOString(),
                Status: 'pending',
            });

            this.logger.log(`Successfully synced beta request to Google Sheets for user ${userId}`);
        } catch (error) {
            this.logger.error('Error in syncToGoogleSheets', error);
        }
    }
}
