const { View, Text, Image, ScrollView, FlatList } = require('react-native');

const NOOP = () => {};
const IDENTITY = (v: unknown) => v;
const NOOP_NODE = { value: 0 };

const Animated = {
  call: NOOP,
  createAnimatedComponent: (component: unknown) => component,
  event: NOOP,
  addWhitelistedUIProps: NOOP,
  addWhitelistedNativeProps: NOOP,
  Value: jest.fn(),
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
};

const Reanimated = {
  __esModule: true,
  default: Animated,
  useSharedValue: (init: unknown) => ({ value: init }),
  useAnimatedStyle: (fn: () => object) => fn(),
  useAnimatedReaction: (prepare: () => unknown, react: (v: unknown) => void) => { react(prepare()); },
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useAnimatedScrollHandler: () => NOOP,
  useAnimatedGestureHandler: () => NOOP,
  useAnimatedRef: () => ({ current: null }),
  withTiming: IDENTITY,
  withSpring: IDENTITY,
  withDecay: IDENTITY,
  withDelay: (_: number, anim: unknown) => anim,
  withSequence: IDENTITY,
  withRepeat: IDENTITY,
  cancelAnimation: NOOP,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  runOnUI: (fn: (...args: unknown[]) => unknown) => fn,
  interpolate: NOOP,
  interpolateColor: (_value: number, _inputRange: number[], outputRange: string[]) => outputRange[0],
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  Easing: { linear: IDENTITY, ease: IDENTITY, bezier: () => IDENTITY, in: IDENTITY, out: IDENTITY, inOut: IDENTITY },
  SlideInDown: { duration: () => ({ easing: () => ({}) }) },
  SlideOutDown: { duration: () => ({ easing: () => ({}) }) },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  Layout: {},
  LinearTransition: { duration: () => ({}) },
  FadeInDown: { duration: () => ({ springify: () => ({}) }) },
  FadeOutUp: { duration: () => ({}) },
  createAnimatedComponent: (component: unknown) => component,
  Keyframe: jest.fn().mockImplementation(() => ({ duration: () => ({}) })),
  measure: () => NOOP_NODE,
  scrollTo: NOOP,
  makeMutable: (init: unknown) => ({ value: init }),
  ReduceMotion: { System: 'system' },
  configureReanimatedLogger: NOOP,
  ReanimatedLogLevel: { warn: 1 },
};

module.exports = Reanimated;
