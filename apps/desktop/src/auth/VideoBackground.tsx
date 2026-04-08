import React, {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

interface VideoBackgroundProps {
  videos: string[];
  ref?: React.Ref<VideoBackgroundHandle>;
}

export interface VideoBackgroundHandle {
  skip: () => void;
}

const FADE_MS = 1200;

export function VideoBackground({ videos, ref }: VideoBackgroundProps) {
  const [startIndex] = useState(() =>
    Math.floor(Math.random() * videos.length)
  );
  const activeSlotRef = useRef<0 | 1>(0);
  const currentIndex = useRef(startIndex);
  const lastAdvance = useRef(0);
  const preloadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Track what each slot should have next (may differ from current src during transitions)
  const pendingSrc = useRef<(string | null)[]>([null, null]);
  const [, forceRender] = useState(0);
  const [slots, setSlots] = useState(() => [
    { src: videos[startIndex], visible: false },
    { src: videos[(startIndex + 1) % videos.length], visible: false },
  ]);
  const videoRef0 = useRef<HTMLVideoElement>(null);
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRefs = [videoRef0, videoRef1];

  const handleFirstLoad = () => {
    setSlots((prev) => {
      const next = [...prev];
      next[0] = { ...next[0], visible: true };
      return next;
    });
  };

  const advance = () => {
    const now = Date.now();
    if (now - lastAdvance.current < 300) return;
    lastAdvance.current = now;

    const activeSlot = activeSlotRef.current;
    const nextSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;
    const nextIndex = (currentIndex.current + 1) % videos.length;
    const followingIndex = (nextIndex + 1) % videos.length;

    // Pause old video
    videoRefs[activeSlot].current?.pause();

    // Update refs synchronously
    activeSlotRef.current = nextSlot;
    currentIndex.current = nextIndex;

    // If the next slot has a pending src that hasn't been applied yet, apply it now
    const pending = pendingSrc.current[nextSlot];
    if (pending) {
      const vid = videoRefs[nextSlot].current;
      if (vid && vid.src !== pending) {
        vid.src = pending;
        vid.load();
      }
      pendingSrc.current[nextSlot] = null;
    }

    // Crossfade: show next, hide current (but DON'T change current's src yet)
    videoRefs[nextSlot].current?.play();
    setSlots((prev) => {
      const next = [...prev];
      next[nextSlot] = { ...next[nextSlot], visible: true };
      next[activeSlot] = { ...next[activeSlot], visible: false };
      return next;
    });
    forceRender((n) => n + 1);

    // After fade-out completes, swap the old slot's src for preloading
    clearTimeout(preloadTimer.current);
    const oldSlot = activeSlot;
    preloadTimer.current = setTimeout(() => {
      const srcToLoad = videos[followingIndex];
      setSlots((prev) => {
        const next = [...prev];
        next[oldSlot] = { src: srcToLoad, visible: false };
        return next;
      });
      pendingSrc.current[oldSlot] = null;
    }, FADE_MS + 100);

    // Store the intended src so rapid advances can apply it
    pendingSrc.current[oldSlot] = videos[followingIndex];
  };

  useImperativeHandle(ref, () => ({ skip: advance }), [advance]);

  const handleEnded = (slotIndex: number) => {
    if (slotIndex === activeSlotRef.current) {
      advance();
    }
  };

  // Preload the inactive slot when its src changes
  useEffect(() => {
    const inactiveSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    const vid = videoRefs[inactiveSlot].current;
    if (vid) {
      vid.load();
    }
  }, [slots[0].src, slots[1].src]);

  return (
    <div className="absolute inset-0 bg-black">
      {slots.map((slot, i) => (
        <video
          key={i}
          ref={videoRefs[i]}
          autoPlay={i === 0}
          muted
          playsInline
          preload="auto"
          onLoadedData={i === 0 ? handleFirstLoad : undefined}
          onEnded={() => handleEnded(i)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ease-out ${
            slot.visible ? "opacity-100" : "opacity-0"
          }`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          src={slot.src}
        />
      ))}
    </div>
  );
}
