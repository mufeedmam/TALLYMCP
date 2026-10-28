// Typed wrapper over THE shared FIFO core (db/fifo-core.mjs). Importing the same
// file the pipeline uses is deliberate: an "as of <date>" recompute here must be
// the identical algorithm to the reconciled fact.fact_receivables_fifo table,
// and a second copy would silently drift.
// Resolvable because next.config.ts sets turbopack.root to the repo root.
import { fifoMatchByLedger as _fifoMatchByLedger } from '../../../../db/fifo-core.mjs';

export interface FifoInputRow {
  ledger_name: string;
  date: string | Date;
  signed_amount: string | number;
}

export interface FifoLayer {
  ledger_name: string;
  opened_date: string | Date;
  remaining_amount: number;
}

export const fifoMatchByLedger = _fifoMatchByLedger as (rows: FifoInputRow[]) => FifoLayer[];
