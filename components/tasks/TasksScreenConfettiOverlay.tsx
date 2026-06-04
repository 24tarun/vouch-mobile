import { memo, useState, useEffect } from 'react';
import { View } from 'react-native';
import LottieView from 'lottie-react-native';

interface Props {
  burstCount: number;
}

export const TasksScreenConfettiOverlay = memo(function TasksScreenConfettiOverlay({
  burstCount,
}: Props) {
  const [confettiBursts, setConfettiBursts] = useState<number[]>([]);
  const [pendingBursts, setPendingBursts] = useState(0);

  useEffect(() => {
    if (pendingBursts <= 0) return;
    if (confettiBursts.length >= 2) return;
    const burstId = Date.now() + Math.random();
    setConfettiBursts((prev) => [...prev, burstId]);
    setPendingBursts((prev) => Math.max(0, prev - 1));
  }, [pendingBursts, confettiBursts]);

  useEffect(() => {
    if (burstCount <= 0) return;
    if (confettiBursts.length >= 2) {
      setPendingBursts((prev) => prev + 1);
    } else {
      const burstId = Date.now() + Math.random();
      setConfettiBursts((prev) => [...prev, burstId]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstCount]);

  if (confettiBursts.length === 0) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {confettiBursts.map((burstId) => (
        <LottieView
          key={`lottie-${burstId}`}
          source={require('../../assets/animations/confetti.json')}
          autoPlay
          loop={false}
          speed={2.1}
          resizeMode="cover"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          onAnimationFinish={() => setConfettiBursts((prev) => prev.filter((id) => id !== burstId))}
        />
      ))}
    </View>
  );
});
