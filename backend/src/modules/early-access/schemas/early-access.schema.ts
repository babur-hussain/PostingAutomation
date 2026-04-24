import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EarlyAccessDocument = EarlyAccess & Document;

@Schema({ timestamps: true })
export class EarlyAccess {
    @Prop({ type: String, required: true })
    name: string;

    @Prop({ type: String, required: true, unique: true })
    email: string;

    @Prop({ type: String, required: true })
    mobile: string;

    @Prop({ type: String, default: 'pending', enum: ['pending', 'approved'] })
    status: string;
}

export const EarlyAccessSchema = SchemaFactory.createForClass(EarlyAccess);
