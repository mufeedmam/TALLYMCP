'use server';

import { revalidatePath } from 'next/cache';
import { updateReceivablesConfig } from '@/lib/analytics/receivablesConfig';

function parseNumberList(s: FormDataEntryValue | null): number[] {
  return String(s ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

export async function saveReceivablesSettings(formData: FormData): Promise<void> {
  const agingEdges = parseNumberList(formData.get('agingEdges'));
  const dormantDays = Number(formData.get('dormantDays'));
  const spikeX = Number(formData.get('spikeX'));
  const tinyDays = Number(formData.get('tinyDays'));
  const tinyAmount = Number(formData.get('tinyAmount'));
  const wOverdue = Number(formData.get('wOverdue'));
  const wAge = Number(formData.get('wAge'));
  const wConcentration = Number(formData.get('wConcentration'));
  const wDormancy = Number(formData.get('wDormancy'));

  const updates: Record<string, unknown> = {};
  if (agingEdges.length >= 2) updates['receivables.aging_edges'] = agingEdges;
  if (Number.isFinite(dormantDays) && dormantDays > 0) updates['receivables.dormant_days'] = dormantDays;
  if (Number.isFinite(spikeX) && spikeX > 0) updates['receivables.spike_x'] = spikeX;
  if (Number.isFinite(tinyDays) && tinyDays > 0) updates['receivables.tiny_days'] = tinyDays;
  if (Number.isFinite(tinyAmount) && tinyAmount > 0) updates['receivables.tiny_amount'] = tinyAmount;
  if ([wOverdue, wAge, wConcentration, wDormancy].every((n) => Number.isFinite(n) && n >= 0)) {
    updates['receivables.risk_weights'] = { overdue: wOverdue, age: wAge, concentration: wConcentration, breach: wDormancy };
  }

  if (Object.keys(updates).length > 0) {
    await updateReceivablesConfig(updates);
  }
  revalidatePath('/receivables');
}
