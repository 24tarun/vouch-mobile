import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const ONBOARDING_KEY = 'vouch_onboarding_seen';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface Slide {
  id: string;
  wordmark?: true;
  icon?: FeatherName;
  iconColor: string;
  iconBg?: string;
  headline: string;
  body: string;
}

async function markSeen() {
  await AsyncStorage.setItem(ONBOARDING_KEY, '1');
}

function SlideView({ item, styles }: { item: Slide; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.slide}>
      <View style={styles.visual}>
        {item.wordmark ? (
          <Text style={[styles.wordmarkHero, { color: item.iconColor }]}>vouch</Text>
        ) : (
          <View style={[styles.iconCircle, { backgroundColor: item.iconBg }]}>
            <Feather name={item.icon!} size={44} color={item.iconColor} />
          </View>
        )}
      </View>

      <Text style={styles.headline}>{item.headline}</Text>
      <Text style={styles.body}>{item.body}</Text>
    </View>
  );
}

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const SLIDES: Slide[] = useMemo(() => [
    {
      id: 'welcome',
      wordmark: true,
      iconColor: colors.accentCyan,
      headline: 'hold yourself\naccountable.',
      body: 'The only commitment app with real consequences.',
    },
    {
      id: 'tasks',
      icon: 'clock' as FeatherName,
      iconColor: colors.accentCyan,
      iconBg: 'rgba(0, 217, 255, 0.07)',
      headline: 'Set a deadline.',
      body: 'Create tasks with a hard deadline and a failure cost — real money on the line.',
    },
    {
      id: 'voucher',
      icon: 'users' as FeatherName,
      iconColor: '#A78BFA',
      iconBg: 'rgba(167, 139, 250, 0.07)',
      headline: 'Pick a voucher.',
      body: "A trusted friend who verifies your work and decides if you've earned the pass.",
    },
    {
      id: 'stakes',
      icon: 'zap' as FeatherName,
      iconColor: colors.warning,
      iconBg: 'rgba(245, 158, 11, 0.07)',
      headline: 'Skin in the game.',
      body: 'Miss the deadline? Your voucher decides. The stakes make the commitment stick.',
    },
  ], [colors.accentCyan, colors.warning]);

  const router = useRouter();
  const listRef = useRef<FlatList<Slide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]?.index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  async function handleNext() {
    if (activeIndex < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      await markSeen();
      router.replace('/(auth)/sign-up');
    }
  }

  async function handleSignIn() {
    await markSeen();
    router.replace('/(auth)/sign-in');
  }

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.id}
        renderItem={({ item }: ListRenderItemInfo<Slide>) => <SlideView item={item} styles={styles} />}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        scrollEventThrottle={16}
        style={styles.list}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.nextLabel}>{isLast ? 'Create account' : 'Next'}</Text>
          {!isLast && (
            <Feather
              name="arrow-right"
              size={17}
              color={colors.primaryFg}
              style={{ marginLeft: spacing.xs }}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSignIn}
          activeOpacity={0.6}
          style={styles.signInRow}
        >
          <Text style={styles.signInText}>
            Already have an account?{'  '}
            <Text style={styles.signInHighlight}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    flex: 1,
  },
  slide: {
    width: SCREEN_W,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  visual: {
    marginBottom: spacing.xl + spacing.md,
    alignItems: 'center',
  },
  wordmarkHero: {
    fontSize: 72,
    fontWeight: typography.bold,
    letterSpacing: -3,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  headline: {
    fontSize: typography.xxl + 4,
    fontWeight: typography.bold,
    color: colors.text,
    textAlign: 'center',
    letterSpacing: -0.8,
    lineHeight: 38,
    marginBottom: spacing.md,
  },
  body: {
    fontSize: typography.base,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 300,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  dotActive: {
    width: 22,
    backgroundColor: colors.text,
  },
  nextButton: {
    width: '100%',
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextLabel: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.primaryFg,
    letterSpacing: 0.1,
  },
  signInRow: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  signInHighlight: {
    color: colors.text,
    fontWeight: typography.medium,
  },
});
