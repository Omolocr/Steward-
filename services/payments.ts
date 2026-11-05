import { Allocation, Payment } from '../types';

export interface SplitInput { category: string; percent: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The "system AI" split: turns percentages into exact amounts that always add up to the total. */
export function calculateSplit(amount: number, rows: SplitInput[]): { allocations: Allocation[]; error?: string } {
  const clean = rows.filter((r) => r.category && r.percent > 0);
  if (!(amount > 0)) return { allocations: [], error: 'Enter the amount paid.' };
  if (clean.length === 0) return { allocations: [], error: 'Add at least one category.' };
  const total = round2(clean.reduce((s, r) => s + r.percent, 0));
  if (total !== 100) return { allocations: [], error: `Percentages add up to ${total}%. They must add up to 100%.` };
  let allocated = 0;
  const allocations = clean.map((r, i) => {
    // The last row takes the rounding remainder so the amounts always equal the total paid.
    const amt = i === clean.length - 1 ? round2(amount - allocated) : round2((amount * r.percent) / 100);
    allocated = round2(allocated + amt);
    return { category: r.category, percent: r.percent, amount: amt };
  });
  return { allocations };
}

/** M-Pesa confirmation codes are 10 characters, letters and digits (e.g. SGH7K2L9QX). */
export const isValidMpesaCode = (c: string) => /^[A-Z0-9]{10}$/.test(c.trim().toUpperCase());

export const isDuplicateCode = (payments: Payment[], code: string) =>
  payments.some((p) => p.mpesaCode === code.trim().toUpperCase());

export const ksh = (n: number) => 'KSh ' + n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function buildReceiptText(p: {
  receiptNo: string; church: string; memberName: string; mpesaCode: string; mpesaName: string;
  amount: number; purpose: string; allocations: Allocation[]; issuedBy: string; issuedAt: string;
}): string {
  const lines = p.allocations.map((a) => `  ${a.category} (${a.percent}%): ${ksh(a.amount)}`).join('\n');
  return [
    `OFFICIAL RECEIPT  ${p.receiptNo}`,
    p.church,
    `Date: ${new Date(p.issuedAt).toLocaleString()}`,
    '',
    `Received from: ${p.memberName}`,
    `M-Pesa name: ${p.mpesaName}`,
    `M-Pesa code: ${p.mpesaCode}`,
    `Purpose: ${p.purpose}`,
    '',
    'Breakdown:',
    lines,
    `Total: ${ksh(p.amount)}`,
    '',
    `Received by: ${p.issuedBy} (Church Treasurer)`,
    'Thank you. God bless you.',
  ].join('\n');
}
