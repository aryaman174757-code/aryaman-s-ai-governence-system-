import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRiskScore(score: number): string {
  return (score * 100).toFixed(1) + '%';
}

export const getRiskLevel = (score: number) => {
  if (score < 0.3) return { label: 'Low', color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
  if (score < 0.7) return { label: 'Medium', color: 'text-amber-500', bg: 'bg-amber-500/10' };
  return { label: 'High', color: 'text-rose-500', bg: 'bg-rose-500/10' };
};
