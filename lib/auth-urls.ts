const DEFAULT_WEBSITE_URL = 'https://tas.tarunh.com';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function readWebsiteUrl(): string {
  const raw = process.env.EXPO_PUBLIC_WEBSITE_URL?.trim();
  if (!raw) return DEFAULT_WEBSITE_URL;
  return stripTrailingSlash(raw);
}

export const WEBSITE_URL = readWebsiteUrl();
const EMAIL_CONFIRMED_PATH = '/email-confirmed';
export const EMAIL_CONFIRMATION_URL = `${WEBSITE_URL}${EMAIL_CONFIRMED_PATH}`;
export const OPEN_APP_SIGN_IN_URL = 'vouch://sign-in';
