// Lightweight pub-sub for the navbar credits indicator.
// Components dispatch a refresh request after a credit-changing action,
// and the navbar listens to refresh + play a small animation.

export type CreditsPulseDetail = {
  delta: number; // negative for spend, positive for top-up
  newBalance?: number;
};

export const CREDITS_REFRESH_EVENT = "credits:refresh";
export const CREDITS_PULSE_EVENT = "credits:pulse";

export const requestCreditsRefresh = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CREDITS_REFRESH_EVENT));
  }
};

export const pulseCredits = (detail: CreditsPulseDetail) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CreditsPulseDetail>(CREDITS_PULSE_EVENT, { detail }));
  }
};
