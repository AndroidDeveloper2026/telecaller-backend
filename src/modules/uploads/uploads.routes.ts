import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { extname } from 'path';
import { Contact } from '../../models';
import { api, badRequest } from '../../common/http';
import { normalizePhone } from '../../common/util';
import { distribute } from '../assignments/assignments.routes';

const ALIASES: Record<string, string[]> = {
  name: ['name', 'fullname', 'customername', 'contactname', 'customer'], phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'contact', 'contactno', 'contactnumber', 'number', 'whatsapp'],
  email: ['email', 'emailid', 'emailaddress', 'mail'], company: ['company', 'companyname', 'organization', 'organisation'], city: ['city', 'location', 'town'],
};
const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => (['.csv', '.xlsx', '.xls'].includes(extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(badRequest('Only .csv, .xls, .xlsx files are allowed') as any)) });

export const uploadsRouter = Router(); const r = api(uploadsRouter, 'uploads', '/uploads');
r('post', '/contacts', ['ADMIN'], 'Import contacts from CSV/Excel (optional equal distribution)', upload.single('file'), async (req) => {
  if (!req.file) throw badRequest('File is required');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' }); const sheet = wb.Sheets[wb.SheetNames[0]]; if (!sheet) throw badRequest('File has no data');
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });
  if (!rows.length) throw badRequest('File has no rows'); if (rows.length > 50000) throw badRequest('Maximum 50,000 rows per upload');
  const errors: { row: number; reason: string }[] = []; const seen = new Set<string>(); const valid: any[] = []; let dupInFile = 0;
  rows.forEach((raw, i) => {
    const m: Record<string, any> = {}; const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) { const nk = key(k); const f = Object.keys(ALIASES).find((a) => ALIASES[a].includes(nk)); if (f && m[f] === undefined) m[f] = String(v).trim(); else if (String(v).trim() !== '') extra[k.slice(0, 50)] = String(v).slice(0, 500); }
    const phone = normalizePhone(m.phone);
    if (!m.name) return void errors.push({ row: i + 2, reason: 'Missing name' }); if (!phone) return void errors.push({ row: i + 2, reason: 'Invalid phone number' });
    if (m.email && !/^\S+@\S+\.\S+$/.test(m.email)) return void errors.push({ row: i + 2, reason: 'Invalid email' });
    if (seen.has(phone)) return void dupInFile++; seen.add(phone);
    valid.push({ name: m.name.slice(0, 120), phone, email: m.email || undefined, company: m.company || undefined, city: m.city || undefined, extra: Object.keys(extra).length ? extra : undefined, createdBy: req.user!.id });
  });
  const existing = new Set((await Contact.find({ phone: { $in: valid.map((v) => v.phone) } }).select('phone').lean()).map((c: any) => c.phone));
  const fresh = valid.filter((v) => !existing.has(v.phone)); const inserted: any[] = fresh.length ? await Contact.insertMany(fresh, { ordered: false }) : [];
  const distribution = req.body.distribute === 'true' && inserted.length ? await distribute(req.user!.id, undefined, inserted.map((c) => String(c._id))) : null;
  return { totalRows: rows.length, inserted: inserted.length, duplicates: dupInFile + (valid.length - fresh.length), invalid: errors.length, errors: errors.slice(0, 100), distribution };
});
