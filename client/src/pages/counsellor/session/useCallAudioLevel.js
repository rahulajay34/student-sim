import { useEffect, useRef, useState } from "react";

// rAF loop reading time-domain data from an AnalyserNode → smoothed 0..1 level.
// getAnalyser: function returning an AnalyserNode (or null before init).
// active: set false to pause the loop (e.g. call not live).
// Returns a number in [0, 1] updated each animation frame.
export default function useCallAudioLevel(getAnalyser, active = true) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(null);
  const smoothRef = useRef(0);
  const dataRef = useRef(null); // reused Uint8Array to avoid per-frame allocation

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      smoothRef.current = 0;
      setLevel(0);
      return;
    }

    let stopped = false;

    function tick() {
      if (stopped) return;

      // Skip work while the tab is hidden (saves power; resumes on visibility).
      if (!document.hidden) {
        const analyser = getAnalyser?.();
        if (analyser) {
          const bufLen = analyser.frequencyBinCount; // fftSize / 2 = 128
          if (!dataRef.current || dataRef.current.length !== bufLen) {
            dataRef.current = new Uint8Array(bufLen);
          }
          analyser.getByteTimeDomainData(dataRef.current);

          // RMS over the 128-sample snapshot (values are 0–255, centred at 128).
          let sumSq = 0;
          for (let i = 0; i < bufLen; i++) {
            const v = (dataRef.current[i] - 128) / 128; // normalise to [-1, 1]
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / bufLen);

          // Scale: typical speech RMS ~0.02–0.05 → map so 0.04 ≈ 1.0.
          // Clamp 0..1 then apply exponential smoothing.
          const raw = Math.min(rms / 0.04, 1);
          smoothRef.current = 0.8 * smoothRef.current + 0.2 * raw;
          // Zero-snap: if raw is essentially silence and smooth has decayed close
          // to zero, clamp to exactly 0 so setState bails out and re-renders stop.
          if (raw < 0.01 && smoothRef.current < 0.005) {
            smoothRef.current = 0;
          }
          setLevel(smoothRef.current);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    function onVisibilityChange() {
      if (document.hidden) {
        // Tab hidden — cancel loop; it restarts on next rAF when visible again.
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else if (!stopped) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      smoothRef.current = 0;
    };
  }, [active, getAnalyser]);

  return level;
}
