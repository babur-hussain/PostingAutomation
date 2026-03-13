import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { FirebaseAuthGuard } from '../../modules/auth/guards/firebase-auth.guard';
import { FirebaseService } from '../../modules/auth/firebase.service';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class JwtAuthGuard extends FirebaseAuthGuard {
  constructor(
    reflector: Reflector,
    firebaseService: FirebaseService,
    usersService: UsersService,
  ) {
    super(reflector, firebaseService, usersService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}

