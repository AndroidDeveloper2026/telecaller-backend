import { Schema, model } from 'mongoose';
const ObjectId = Schema.Types.ObjectId;

export const PRESENCE = ['AVAILABLE', 'ON_CALL', 'BREAK', 'OFFLINE'];
export const CONTACT_STATUS = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'FOLLOW_UP', 'COMPLETED'];
export const CALL_STATUS = ['CONNECTED', 'NO_ANSWER', 'BUSY', 'NOT_REACHABLE', 'WRONG_NUMBER'];

const user = new Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, phone: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: ['ADMIN', 'EMPLOYEE'], default: 'EMPLOYEE', index: true },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true }, presence: { type: String, enum: PRESENCE, default: 'OFFLINE' },
  refreshTokenHash: { type: String, select: false },
}, { timestamps: true });

const contact = new Schema({
  name: { type: String, required: true, trim: true }, phone: { type: String, required: true, unique: true, trim: true }, email: { type: String, trim: true, lowercase: true },
  company: { type: String, trim: true }, city: { type: String, trim: true }, extra: { type: Schema.Types.Mixed },
  status: { type: String, enum: CONTACT_STATUS, default: 'NEW', index: true }, priority: { type: Number, enum: [1, 2, 3], default: 2 }, // 1 high, 2 medium, 3 low
  assignedTo: { type: ObjectId, ref: 'User', index: true, default: null }, assignedAt: Date, callCount: { type: Number, default: 0 },
  lastCalledAt: Date, lastDisposition: String, lastNote: String, followUpAt: { type: Date, index: true }, createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
contact.index({ assignedTo: 1, status: 1, priority: 1 });

const assignment = new Schema({
  contact: { type: ObjectId, ref: 'Contact', required: true, index: true }, employee: { type: ObjectId, ref: 'User', required: true, index: true },
  assignedBy: { type: ObjectId, ref: 'User', required: true }, status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'REASSIGNED'], default: 'ACTIVE', index: true },
}, { timestamps: { createdAt: 'assignedAt', updatedAt: true } });

const callLog = new Schema({
  contact: { type: ObjectId, ref: 'Contact', required: true, index: true }, employee: { type: ObjectId, ref: 'User', required: true, index: true },
  startTime: { type: Date, required: true, index: true }, endTime: Date, duration: { type: Number, default: 0, min: 0 },
  callStatus: { type: String, enum: CALL_STATUS, default: 'CONNECTED', index: true }, disposition: { type: String, required: true, index: true },
  notes: { type: String, trim: true, maxlength: 2000 }, followUpAt: Date, durationSource: { type: String, enum: ['MANUAL', 'DEVICE'], default: 'MANUAL' },
  clientId: { type: String, unique: true, sparse: true }, // offline idempotency key
}, { timestamps: true });
callLog.index({ employee: 1, startTime: -1 });

const setting = new Schema({ key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed }, { timestamps: true });
const notification = new Schema({ user: { type: ObjectId, ref: 'User', required: true, index: true }, title: { type: String, required: true }, message: String, type: { type: String, default: 'INFO' }, read: { type: Boolean, default: false, index: true } }, { timestamps: { createdAt: true, updatedAt: false } });
const audit = new Schema({ actor: { type: ObjectId, ref: 'User', index: true }, action: { type: String, required: true }, entity: String, entityId: String, meta: Schema.Types.Mixed }, { timestamps: { createdAt: true, updatedAt: false } });

export const User = model<any>('User', user);
export const Contact = model<any>('Contact', contact);
export const Assignment = model<any>('Assignment', assignment);
export const CallLog = model<any>('CallLog', callLog);
export const Setting = model<any>('Setting', setting);
export const Notification = model<any>('Notification', notification);
export const AuditLog = model<any>('AuditLog', audit);
