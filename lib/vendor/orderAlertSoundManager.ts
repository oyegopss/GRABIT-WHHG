"use client";

const SOUND_URL = "/sounds/new-order.mp3";
const RING_PAUSE_MS = 1200;
const UNLOCK_STORAGE_KEY = "grabit_vendor_sound_unlocked_v2";
const VIBRATION_PATTERN = [0, 600, 200, 600, 200, 600];

type SoundStateListener = (ringing: boolean) => void;

class OrderAlertSoundManager {
  private static instance: OrderAlertSoundManager | null = null;
  private audio: HTMLAudioElement | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private isRingingState: boolean = false;
  private isUnlockedState: boolean = false;
  private listeners: Set<SoundStateListener> = new Set();

  private constructor() {
    if (typeof window !== "undefined") {
      this.initAudio();
      this.isUnlockedState = this.readStoredUnlock();
    }
  }

  public static getInstance(): OrderAlertSoundManager {
    if (!OrderAlertSoundManager.instance) {
      OrderAlertSoundManager.instance = new OrderAlertSoundManager();
    }
    return OrderAlertSoundManager.instance;
  }

  private initAudio() {
    try {
      this.audio = new Audio(SOUND_URL);
      this.audio.preload = "auto";
      this.audio.onended = () => {
        if (!this.isRingingState) return;
        this.pauseTimer = setTimeout(() => {
          this.playOnce();
        }, RING_PAUSE_MS);
      };
    } catch (err) {
      console.warn("[orderAlertSoundManager] Audio initialization error:", err);
    }
  }

  private readStoredUnlock(): boolean {
    try {
      return localStorage.getItem(UNLOCK_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  public isUnlocked(): boolean {
    return this.isUnlockedState;
  }

  public isRinging(): boolean {
    return this.isRingingState;
  }

  public addStateListener(listener: SoundStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.isRingingState);
      } catch (err) {
        console.warn("[orderAlertSoundManager] Listener error:", err);
      }
    });
  }

  /**
   * Prime audio context on user gesture (browser autoplay policy requirement).
   */
  public unlock(): void {
    if (typeof window === "undefined" || !this.audio) return;

    this.audio.muted = true;
    this.audio
      .play()
      .then(() => {
        if (this.audio) {
          this.audio.pause();
          this.audio.currentTime = 0;
          this.audio.muted = false;
        }
        this.isUnlockedState = true;
        try {
          localStorage.setItem(UNLOCK_STORAGE_KEY, "1");
        } catch {
          // Storage fallback
        }
      })
      .catch(() => {
        if (this.audio) {
          this.audio.muted = false;
        }
      });
  }

  private playOnce(): void {
    if (!this.isRingingState || !this.audio) return;

    this.audio.currentTime = 0;
    this.audio.play().catch((err) => {
      console.warn("[orderAlertSoundManager] Audio play failed:", err);
      // If browser blocked un-primed audio, do not get stuck in infinite error loop
      if (err.name === "NotAllowedError") {
        this.isUnlockedState = false;
        this.stop();
      }
    });

    // Hardware vibration trigger
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(VIBRATION_PATTERN);
      } catch {
        // Vibration not supported / permitted
      }
    }
  }

  /**
   * Starts the continuous incoming order ring and vibration alert.
   */
  public start(): void {
    if (typeof window === "undefined") return;
    if (this.isRingingState) return; // Already active

    console.info("[ORDER ALERT] Sound started");
    this.isRingingState = true;
    this.notifyListeners();

    if (!this.audio) {
      this.initAudio();
    }

    this.playOnce();
  }

  /**
   * Stops the order alert audio and cancels vibration immediately.
   */
  public stop(): void {
    if (typeof window === "undefined") return;
    if (!this.isRingingState && !this.pauseTimer) return;

    console.info("[ORDER ALERT] Sound stopped");
    this.isRingingState = false;

    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }

    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(0); // Cancel vibration
      } catch {
        // Ignore
      }
    }

    this.notifyListeners();
  }
}

export const orderAlertSoundManager = OrderAlertSoundManager.getInstance();

export function startOrderAlert(): void {
  orderAlertSoundManager.start();
}

export function stopOrderAlert(): void {
  orderAlertSoundManager.stop();
}

export function unlockOrderAlertSound(): void {
  orderAlertSoundManager.unlock();
}
