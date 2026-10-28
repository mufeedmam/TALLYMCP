'use server';

import { revalidatePath } from 'next/cache';
import { updateInventoryConfig } from '@/lib/analytics/inventoryConfig';

export async function saveInventorySettings(formData: FormData): Promise<void> {
  const slowDays = Number(formData.get('slowDays'));
  const marginLow = Number(formData.get('marginLow'));
  const marginHigh = Number(formData.get('marginHigh'));

  const updates: Record<string, unknown> = {};
  if (Number.isFinite(slowDays) && slowDays > 0) updates['inventory.slow_days'] = slowDays;
  if (Number.isFinite(marginLow) && Number.isFinite(marginHigh) && marginLow < marginHigh) {
    updates['inventory.margin_band'] = [marginLow, marginHigh];
  }

  if (Object.keys(updates).length > 0) await updateInventoryConfig(updates);
  revalidatePath('/inventory');
}
