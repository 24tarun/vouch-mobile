import type { CSSProperties } from 'react';
import { OPEN_APP_SIGN_IN_URL, WEBSITE_URL } from '@/lib/auth-urls';

export default function EmailConfirmedWebPage() {
  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Your email has been verified</h1>
      <p style={styles.body}>Thanks for confirming your email. You can continue in the app or on the website.</p>
      <p style={styles.links}>
        <a href={OPEN_APP_SIGN_IN_URL} style={styles.link}>Open the app</a>
      </p>
      <p style={styles.links}>
        <a href={WEBSITE_URL} style={styles.link}>Open the website</a>
      </p>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: '100vh',
    fontFamily: 'Arial, sans-serif',
    maxWidth: 720,
    margin: '0 auto',
    padding: '40px 20px',
    lineHeight: 1.5,
  },
  title: {
    fontSize: 28,
    margin: 0,
  },
  body: {
    marginTop: 16,
    marginBottom: 24,
    fontSize: 18,
  },
  links: {
    margin: '8px 0',
    fontSize: 18,
  },
  link: {
    color: '#0b5fff',
    textDecoration: 'underline',
  },
};
