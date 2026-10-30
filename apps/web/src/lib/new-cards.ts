import {
  LEARNING_LIMIT_MAX,
  LEARNING_LIMIT_MIN,
  NEW_CARD_BATCH_MAX,
  NEW_CARD_BATCH_MIN,
} from "@banki/shared";

// How New cards are paced (CONTEXT.md: New card, New-card batch, Learning
// limit): the Settings → Advanced steppers, and the study screen's offer of
// another batch.

/** A stepper's range, and how far one press moves it. */
export type StepperRange = { min: number; max: number; step: number };

/** The New-card batch, 5–100, in fives. */
export const NEW_CARD_BATCH_RANGE: StepperRange = {
  min: NEW_CARD_BATCH_MIN,
  max: NEW_CARD_BATCH_MAX,
  step: 5,
};

/** The Learning limit, 5–50, one Card at a time. */
export const LEARNING_LIMIT_RANGE: StepperRange = {
  min: LEARNING_LIMIT_MIN,
  max: LEARNING_LIMIT_MAX,
  step: 1,
};

/**
 * The value one press of − (`-1`) or + (`1`) moves `value` to: the next
 * multiple of the step that way, within the range. A value off the steps,
 * such as 37 in fives, moves to 35 or 40.
 */
export function stepped(
  value: number,
  direction: -1 | 1,
  { min, max, step }: StepperRange,
): number {
  const next =
    direction === 1
      ? Math.floor(value / step) * step + step
      : Math.ceil(value / step) * step - step;
  return Math.min(max, Math.max(min, next));
}

/** What a change to a stepper's Setting that didn't save says: the change, and what is kept. */
export const pacingErrorText = (attempted: number, kept: number): string =>
  `The change to ${attempted} didn't save, so it's still ${kept}.`;

/**
 * What the study screen's end offers when the New-card batch held New cards
 * back: how many are waiting, and the button that takes another batch of
 * `batch`. Undefined when none are held, so the end is as it always was.
 */
export function moreOffer(
  newHeld: number,
  batch: number,
): { waiting: string; action: string } | undefined {
  if (newHeld <= 0) return undefined;
  return {
    waiting: newHeld === 1 ? "1 new card is waiting." : `${newHeld} new cards are waiting.`,
    action: `Learn ${batch} more`,
  };
}
