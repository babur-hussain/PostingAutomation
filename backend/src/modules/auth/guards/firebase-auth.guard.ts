import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirebaseService } from '../firebase.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    protected reflector: Reflector,
    private firebaseService: FirebaseService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      const auth = this.firebaseService.getAuth();
      const decodedToken = await auth.verifyIdToken(token);
      
      // Look up or create the user
      let user = await this.usersService.findByFirebaseUid(decodedToken.uid);
      
      if (!user) {
        // Optional: auto-create the user if they don't exist in our DB yet
        const email = decodedToken.email || '';
        const name = decodedToken.name || email.split('@')[0];
        // We'll define createFromFirebase in usersService
        user = await this.usersService.createFromFirebase(decodedToken.uid, email, name);
      }

      // Attach user object to the request
      request.user = {
        userId: user._id.toString(),
        firebaseUid: decodedToken.uid,
        email: user.email,
        name: user.name,
      };

      return true;
    } catch (error) {
      console.error('Firebase token verification error', error);
      throw new UnauthorizedException('Invalid Firebase Token');
    }
  }
}
