import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
 return twMerge(clsx(inputs))
}

/**
 * Format a monetary amount in INR — the only currency this app uses.
 * Grouping uses the en-IN locale (lakh/crore style).
 */
export function formatCurrency(value: number): string {
 return new Intl.NumberFormat("en-IN", {
 style: "currency",
 currency: "INR",
 minimumFractionDigits: 0,
 maximumFractionDigits: 0,
 }).format(Number(value || 0))
}
