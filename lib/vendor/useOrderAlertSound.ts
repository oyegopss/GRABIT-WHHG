"use client";

import { useCallback, useEffect, useState } from "react";
import { orderAlertSoundManager } from "./orderAlertSoundManager";

/**
 * React hook interface for the singleton order alert sound and vibration system.
 * Keeps components reactive while ensuring only one unified audio instance plays across the app.
 */
export function useOrderAlertSound() {
  const [isUnlocked, setIsUnlocked] = useState(orderAlertSoundManager.isUnlocked());
  const [isRinging, setIsRinging] = useState(orderAlertSoundManager.isRinging());

  useEffect(() => {
    // Sync initial state
    setIsUnlocked(orderAlertSoundManager.isUnlocked());
    setIsRinging(orderAlertSoundManager.isRinging());

    // Subscribe to changes in ringing state
    const unsubscribe = orderAlertSoundManager.addStateListener((ringing) => {
      setIsRinging(ringing);
      setIsUnlocked(orderAlertSoundManager.isUnlocked());
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const unlock = useCallback(() => {
    orderAlertSoundManager.unlock();
    setIsUnlocked(true);
  }, []);

  const start = useCallback(() => {
    orderAlertSoundManager.start();
  }, []);

  const stop = useCallback(() => {
    orderAlertSoundManager.stop();
  }, []);

  return { isUnlocked, isRinging, unlock, start, stop };
}
