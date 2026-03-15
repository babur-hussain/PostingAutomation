import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(
    email: string,
    password: string,
    name: string,
  ): Promise<UserDocument> {
    const existing = await this.userModel.findOne({
      email: email.toLowerCase(),
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new this.userModel({
      email: email.toLowerCase(),
      password: hashedPassword,
      name,
    });
    return user.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  async findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(id);
  }

  async findByFirebaseUid(firebaseUid: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ firebaseUid });
  }

  async createFromFirebase(
    firebaseUid: string,
    email: string,
    name: string,
  ): Promise<UserDocument> {
    let user = await this.userModel.findOne({ firebaseUid });
    if (user) {
      return user;
    }

    // We can also check by email, just in case they signed up via email previously
    if (email) {
      user = await this.userModel.findOne({ email: email.toLowerCase() });
      if (user) {
        // Link the Firebase UID to the existing user
        user.firebaseUid = firebaseUid;
        return user.save();
      }
    }

    const randomPassword =
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(randomPassword, 12);

    user = new this.userModel({
      firebaseUid,
      email: email ? email.toLowerCase() : '',
      name: name || 'Firebase User',
      password: hashedPassword,
    });

    return user.save();
  }
}
