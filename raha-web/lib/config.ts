/** Flat delivery fee in naira, added to every order. Change to suit your pricing. */
export const DELIVERY_FEE_NGN = 500;

/**
 * Account customers pay into by manual bank transfer.
 * Set these in .env.local (they are shown to customers, so NEXT_PUBLIC is fine).
 */
export const BANK = {
  bankName: process.env.NEXT_PUBLIC_BANK_NAME ?? "",
  accountNumber: process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER ?? "",
  accountName: process.env.NEXT_PUBLIC_BANK_ACCOUNT_NAME ?? "",
};

export const bankConfigured = Boolean(BANK.bankName && BANK.accountNumber && BANK.accountName);
