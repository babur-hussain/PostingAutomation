import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);

  onModuleInit() {
    if (admin.apps.length === 0) {
      try {
        const keyPath = path.resolve(process.cwd(), 'firebase-adminsdk.json');

        if (fs.existsSync(keyPath)) {
          const serviceAccount = require(keyPath);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
          this.logger.log('Firebase Admin SDK initialized successfully');
        } else {
          this.logger.warn(
            'Firebase Admin SDK configuration not found. Application will start but Auth may fail. Place firebase-adminsdk.json in the root backend folder.',
          );
          // Fallback initialization without credentials (might fail depending on operations)
          admin.initializeApp();
        }
      } catch (error) {
        this.logger.error('Error initializing Firebase Admin SDK', error);
      }
    }
  }

  getAuth() {
    return admin.auth();
  }
}
