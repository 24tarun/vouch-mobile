import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import {
  getAvatarCropLayout,
  getAvatarCropRect,
} from '@/lib/avatar-crop';

const MAX_ZOOM = 4;

function clampWorklet(value: number, minimum: number, maximum: number): number {
  'worklet';
  return Math.min(Math.max(value, minimum), maximum);
}

interface AvatarCropModalProps {
  asset: ImagePickerAsset | null;
  onCancel: () => void;
  onChoose: (asset: ImagePickerAsset) => Promise<void>;
}

export function AvatarCropModal({ asset, onCancel, onChoose }: AvatarCropModalProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cropSize = Math.min(screenWidth - 32, 380);
  const [processing, setProcessing] = useState(false);
  const zoom = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartZoom = useSharedValue(1);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);

  const layout = useMemo(
    () => getAvatarCropLayout(asset?.width ?? 1, asset?.height ?? 1, cropSize),
    [asset?.height, asset?.width, cropSize],
  );

  useEffect(() => {
    zoom.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    setProcessing(false);
  }, [asset?.uri, translateX, translateY, zoom]);

  const gesture = useMemo(() => {
    const constrain = (nextZoom: number, nextX: number, nextY: number) => {
      'worklet';
      const maxX = Math.max(0, (layout.baseWidth * nextZoom - layout.cropSize) / 2);
      const maxY = Math.max(0, (layout.baseHeight * nextZoom - layout.cropSize) / 2);
      translateX.value = clampWorklet(nextX, -maxX, maxX);
      translateY.value = clampWorklet(nextY, -maxY, maxY);
    };

    const pan = Gesture.Pan()
      .onBegin(() => {
        panStartX.value = translateX.value;
        panStartY.value = translateY.value;
      })
      .onUpdate((event) => {
        constrain(
          zoom.value,
          panStartX.value + event.translationX,
          panStartY.value + event.translationY,
        );
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        pinchStartZoom.value = zoom.value;
        pinchStartX.value = translateX.value;
        pinchStartY.value = translateY.value;
      })
      .onUpdate((event) => {
        const nextZoom = clampWorklet(pinchStartZoom.value * event.scale, 1, MAX_ZOOM);
        zoom.value = nextZoom;
        constrain(nextZoom, pinchStartX.value, pinchStartY.value);
      });

    return Gesture.Simultaneous(pan, pinch);
  }, [
    layout.baseHeight,
    layout.baseWidth,
    layout.cropSize,
    panStartX,
    panStartY,
    pinchStartX,
    pinchStartY,
    pinchStartZoom,
    translateX,
    translateY,
    zoom,
  ]);

  const imageStyle = useAnimatedStyle(() => ({
    width: layout.baseWidth * zoom.value,
    height: layout.baseHeight * zoom.value,
    left: (layout.cropSize - layout.baseWidth * zoom.value) / 2 + translateX.value,
    top: (layout.cropSize - layout.baseHeight * zoom.value) / 2 + translateY.value,
  }));

  async function chooseCrop() {
    if (!asset || processing) return;
    setProcessing(true);
    let croppedUri: string | null = null;

    try {
      const crop = getAvatarCropRect(layout, {
        zoom: zoom.value,
        translateX: translateX.value,
        translateY: translateY.value,
      });
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ crop }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );
      croppedUri = result.uri;
      await onChoose({
        uri: result.uri,
        width: result.width,
        height: result.height,
        type: 'image',
        fileName: 'avatar-crop.jpg',
        mimeType: 'image/jpeg',
      });
    } catch (error) {
      Alert.alert(
        'Could not crop photo',
        error instanceof Error ? error.message : 'Please choose the photo again.',
      );
    } finally {
      if (croppedUri) {
        try {
          const file = new File(croppedUri);
          if (file.exists) file.delete();
        } catch {
          // ImageManipulator cache cleanup is best-effort.
        }
      }
      setProcessing(false);
    }
  }

  return (
    <Modal
      visible={asset != null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={processing ? undefined : onCancel}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={onCancel}
            disabled={processing}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cancel profile picture crop"
          >
            <Text style={[styles.headerAction, processing && styles.disabled]}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Move and Scale</Text>
          <Pressable
            onPress={() => { void chooseCrop(); }}
            disabled={processing}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Choose cropped profile picture"
          >
            {processing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.headerAction, styles.choose]}>Choose</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.stage}>
          <GestureDetector gesture={gesture}>
            <View
              style={[styles.cropViewport, { width: cropSize, height: cropSize, borderRadius: cropSize / 2 }]}
              accessibilityLabel="Circular profile picture crop area. Drag to reposition and pinch to zoom."
            >
              {asset ? (
                <Animated.Image
                  source={{ uri: asset.uri }}
                  style={[styles.image, imageStyle]}
                  resizeMode="stretch"
                  accessible={false}
                />
              ) : null}
              <View pointerEvents="none" style={styles.cropRing} />
            </View>
          </GestureDetector>
          <Text style={styles.hint}>Pinch to zoom and drag to reposition</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  headerAction: {
    color: '#FFFFFF',
    fontSize: 17,
    minWidth: 62,
  },
  choose: {
    color: '#38BDF8',
    fontWeight: '600',
    textAlign: 'right',
  },
  disabled: {
    opacity: 0.45,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 56,
  },
  cropViewport: {
    overflow: 'hidden',
    backgroundColor: '#111111',
  },
  cropRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  image: {
    position: 'absolute',
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.70)',
    fontSize: 14,
    marginTop: 24,
  },
});
