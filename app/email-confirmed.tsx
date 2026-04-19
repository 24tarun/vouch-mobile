import { Linking, StyleSheet, Text, View } from 'react-native';
import { OPEN_APP_SIGN_IN_URL, WEBSITE_URL } from '@/lib/auth-urls';
import { colors, spacing, typography } from '@/lib/theme';

export default function EmailConfirmedScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your email has been verified</Text>
      <Text style={styles.body}>
        Thanks for confirming your email. You can continue in the app or on the website.
      </Text>
      <Text style={styles.link} onPress={() => void Linking.openURL(OPEN_APP_SIGN_IN_URL)}>
        Open the app
      </Text>
      <Text style={styles.link} onPress={() => void Linking.openURL(WEBSITE_URL)}>
        Open the website
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.lg,
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontWeight: typography.bold,
    fontSize: 26,
    lineHeight: 32,
  },
  body: {
    color: colors.textMuted,
    fontWeight: typography.normal,
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    color: colors.primary,
    fontWeight: typography.medium,
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});
