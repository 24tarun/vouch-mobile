import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

type CaptureMode = 'photo' | 'video';

interface ProofCaptureModalProps {
  visible: boolean;
  initialMode?: CaptureMode;
  onClose: () => void;
  onAssetPicked: (asset: ImagePicker.ImagePickerAsset) => Promise<void> | void;
}

const MAX_VIDEO_SECONDS = 15;

export function ProofCaptureModal({
  visible,
  initialMode = 'photo',
  onClose,
  onAssetPicked,
}: ProofCaptureModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [mode, setMode] = useState<CaptureMode>(initialMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(MAX_VIDEO_SECONDS);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setIsRecording(false);
    setRecordingSecondsLeft(MAX_VIDEO_SECONDS);
    setFacing('back');
    setPictureSize(undefined);
  }, [visible, initialMode]);

  useEffect(() => {
    if (!visible || mode !== 'video' || !isRecording) {
      setRecordingSecondsLeft(MAX_VIDEO_SECONDS);
      return;
    }

    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, MAX_VIDEO_SECONDS - elapsedSeconds);
      setRecordingSecondsLeft(next);
    }, 200);

    return () => clearInterval(interval);
  }, [visible, mode, isRecording]);

  useEffect(() => {
    if (!visible) return;
    if (cameraPermission?.granted) return;

    (async () => {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Allow camera access in Settings to capture proof media.');
        onClose();
      }
    })();
  }, [visible, cameraPermission?.granted, requestCameraPermission, onClose]);

  async function handlePickedAsset(asset: ImagePicker.ImagePickerAsset) {
    if (asset.type === 'video' && typeof asset.duration === 'number' && asset.duration > 15000) {
      Alert.alert('Video too long', 'Please keep proof videos at 15 seconds or less.');
      return;
    }

    setIsSubmitting(true);
    setIsRecording(false);
    onClose();
    void Promise.resolve(onAssetPicked(asset)).finally(() => {
      setIsSubmitting(false);
    });
  }

  async function handleCapturePress() {
    if (!cameraRef.current || isSubmitting) return;

    if (mode === 'photo') {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.9,
          exif: true,
        });

        if (!photo?.uri) {
          Alert.alert('Could not capture photo', 'Please try again.');
          return;
        }

        await handlePickedAsset({
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
          fileName: photo.uri.split('/').pop() ?? `proof_${Date.now()}.jpg`,
          fileSize: undefined,
          mimeType: 'image/jpeg',
          type: 'image',
          exif: photo.exif as any,
          duration: null,
        });
      } catch {
        Alert.alert('Could not capture photo', 'Please try again.');
      }
      return;
    }

    if (!isRecording) {
      try {
        setIsRecording(true);
        const video = await cameraRef.current.recordAsync({
          maxDuration: MAX_VIDEO_SECONDS,
        });

        if (!video?.uri) {
          setIsRecording(false);
          return;
        }

        await handlePickedAsset({
          uri: video.uri,
          width: 0,
          height: 0,
          fileName: video.uri.split('/').pop() ?? `proof_${Date.now()}.mp4`,
          fileSize: undefined,
          mimeType: 'video/mp4',
          type: 'video',
          duration: MAX_VIDEO_SECONDS * 1000,
        });
      } catch {
        Alert.alert('Could not record video', 'Please try again.');
      } finally {
        setIsRecording(false);
      }
      return;
    }

    cameraRef.current.stopRecording();
  }

  async function handleOpenGallery() {
    if (isSubmitting) return;

    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = current.granted;

    if (!granted) {
      const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
      granted = requested.granted;
    }

    if (!granted) {
      Alert.alert('Photos permission required', 'Allow photo library access in Settings to attach existing media.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: false,
        quality: 0.9,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        exif: true,
        ...(Platform.OS === 'ios'
          ? {
              preferredAssetRepresentationMode:
                ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            }
          : {}),
      });

      if (result.canceled || result.assets.length === 0) return;
      await handlePickedAsset(result.assets[0]);
    } catch {
      Alert.alert('Could not open photo library', 'Please try again.');
    }
  }

  const canRenderCamera = Boolean(cameraPermission?.granted);
  const captureRatio = Platform.OS === 'android' ? '4:3' : undefined;

  function parseSizeLabel(size: string): { width: number; height: number } | null {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  async function resolveBestFourByThreeSize() {
    try {
      const sizes = await (cameraRef.current as any)?.getAvailablePictureSizesAsync?.();
      if (!Array.isArray(sizes) || sizes.length === 0) return;

      const targetRatio = 4 / 3;
      const tolerance = 0.02;
      const parsed = sizes
        .map((s: string) => ({ raw: s, parsed: parseSizeLabel(s) }))
        .filter((entry: { raw: string; parsed: { width: number; height: number } | null }) => entry.parsed !== null)
        .map((entry: { raw: string; parsed: { width: number; height: number } | null }) => {
          const dims = entry.parsed!;
          const ratio = Math.max(dims.width, dims.height) / Math.min(dims.width, dims.height);
          return {
            raw: entry.raw,
            width: dims.width,
            height: dims.height,
            ratio,
            area: dims.width * dims.height,
          };
        })
        .filter((entry: { ratio: number }) => Math.abs(entry.ratio - targetRatio) <= tolerance)
        .sort((a: { area: number }, b: { area: number }) => b.area - a.area);

      if (parsed.length > 0) {
        setPictureSize(parsed[0].raw);
      }
    } catch {
      // Keep device default if picture-size probing is unavailable.
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={onClose} style={styles.topIconBtn} accessibilityLabel="Close camera">
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.modeToggleRow}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'photo' && styles.modeBtnActive]}
                onPress={() => setMode('photo')}
                disabled={isRecording || isSubmitting}
              >
                <Text style={[styles.modeBtnText, mode === 'photo' && styles.modeBtnTextActive]}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'video' && styles.modeBtnActive]}
                onPress={() => setMode('video')}
                disabled={isRecording || isSubmitting}
              >
                <Text style={[styles.modeBtnText, mode === 'video' && styles.modeBtnTextActive]}>Video</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.topIconBtnPlaceholder} />
          </View>

          <View style={styles.cameraWrap}>
            {canRenderCamera ? (
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing={facing}
                mode={mode === 'photo' ? 'picture' : 'video'}
                mute={false}
                ratio={captureRatio}
                pictureSize={pictureSize}
                onCameraReady={() => {
                  void resolveBestFourByThreeSize();
                }}
              />
            ) : (
              <View style={styles.cameraFallback}>
                <ActivityIndicator size="small" color={colors.textMuted} />
              </View>
            )}
          </View>

          <View style={styles.bottomStack}>
            {mode === 'video' ? (
              <View style={styles.timerRow}>
                <View style={[styles.timerPill, isRecording && styles.timerPillActive]}>
                  <Text style={[styles.timerText, isRecording && styles.timerTextActive]}>
                    {`00:${String(recordingSecondsLeft).padStart(2, '0')}`}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={styles.captureRow}>
              <TouchableOpacity
                style={styles.bottomIconBtn}
                onPress={() => { void handleOpenGallery(); }}
                disabled={isRecording || isSubmitting}
                accessibilityLabel="Open gallery"
              >
                <Feather name="image" size={20} color={colors.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.captureBtn,
                  mode === 'video' && styles.captureBtnVideo,
                  isRecording && styles.captureBtnRecording,
                  (isSubmitting || !canRenderCamera) && styles.captureBtnDisabled,
                ]}
                onPress={() => { void handleCapturePress(); }}
                disabled={isSubmitting || !canRenderCamera}
                accessibilityLabel={mode === 'photo' ? 'Take photo' : isRecording ? 'Stop recording' : 'Record video'}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <View style={[styles.captureInner, isRecording && styles.captureInnerRecording]} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.bottomIconBtn}
                onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
                disabled={isRecording || isSubmitting}
                accessibilityLabel="Flip camera"
              >
                <Ionicons name="camera-reverse-outline" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  topIconBtnPlaceholder: {
    width: 36,
    height: 36,
  },
  modeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: radius.full,
    padding: 4,
    gap: 4,
    flexShrink: 1,
  },
  modeBtn: {
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  modeBtnActive: {
    backgroundColor: '#F472B6',
  },
  modeBtnText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
  modeBtnTextActive: {
    color: '#081018',
    fontWeight: typography.semibold,
  },
  cameraWrap: {
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#000',
    aspectRatio: 4 / 3,
    alignSelf: 'stretch',
  },
  camera: {
    flex: 1,
  },
  cameraFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomStack: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  timerRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  timerPill: {
    minWidth: 64,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    alignItems: 'center',
  },
  timerPillActive: {
    borderColor: '#F43F5E88',
    backgroundColor: '#F43F5E22',
  },
  timerText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    fontVariant: ['tabular-nums'],
  },
  timerTextActive: {
    color: '#FCA5A5',
  },
  captureRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  bottomIconBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF0E',
  },
  captureBtnVideo: {
    borderColor: '#F43F5E',
  },
  captureBtnRecording: {
    borderColor: '#F43F5E',
    backgroundColor: '#F43F5E22',
  },
  captureBtnDisabled: {
    opacity: 0.6,
  },
  captureInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
  },
  captureInnerRecording: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F43F5E',
  },
});
