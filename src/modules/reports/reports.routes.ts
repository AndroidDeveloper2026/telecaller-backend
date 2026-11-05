import { Router } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { api, validate } from '../../common/http';
import { listAllLogs, logQuery } from '../call-logs/call-logs.routes';

const safe = (v: any) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v); // CSV/Excel formula-injection guard
export const reportsRouter = Router(); const r = api(reportsRouter, 'reports', '/reports');
r('get', '/calls/export', ['ADMIN'], 'Export call report (csv | xlsx)', validate({ query: logQuery.extend({ format: z.enum(['csv', 'xlsx']).default('csv') }) }), async (req, res) => {
  const rows = (await listAllLogs(req.q, req.user!)).map((l: any) => ({
    Date: l.startTime.toISOString().slice(0, 10), Employee: safe(l.employee?.name), Contact: safe(l.contact?.name), Phone: safe(l.contact?.phone), Company: safe(l.contact?.company || ''), Start: l.startTime.toISOString(),
    End: l.endTime ? l.endTime.toISOString() : '', 'Duration (s)': l.duration, 'Call Status': l.callStatus, Disposition: l.disposition, Notes: safe(l.notes || ''), 'Follow-up': l.followUpAt ? l.followUpAt.toISOString() : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows); const name = `call-report-${new Date().toISOString().slice(0, 10)}`;
  if (req.q.format === 'csv') { res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${name}.csv"` }); return void res.send(Buffer.from(XLSX.utils.sheet_to_csv(ws))); }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Calls');
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` }); res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});
