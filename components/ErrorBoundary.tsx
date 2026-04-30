import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { radius, spacing, typography } from '@/lib/theme';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] unhandled error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Feather name="alert-triangle" size={32} color="#F87171" />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && { opacity: 0.7 },
            ]}
            onPress={this.handleReset}
          >
            <Feather name="refresh-cw" size={16} color="#E2E8F0" />
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: '#0F172A',
  },
  card: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(30,41,59,0.95)',
  },
  title: {
    color: '#F1F5F9',
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    textAlign: 'center',
  },
  message: {
    color: '#94A3B8',
    fontSize: typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: '#3B82F6',
  },
  buttonText: {
    color: '#E2E8F0',
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
});

export default ErrorBoundary;
