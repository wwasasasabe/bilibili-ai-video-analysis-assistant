export type ResponsePreference = "liked" | "disliked" | null;

export interface FeedbackSelectionState {
  responsePreference: ResponsePreference;
  activeTargetId: string | null;
}

export function getNextFeedbackSelection(
  currentState: FeedbackSelectionState,
  targetId: string,
  nextPreference: Exclude<ResponsePreference, null>
): FeedbackSelectionState {
  if (
    currentState.responsePreference === nextPreference &&
    currentState.activeTargetId === targetId
  ) {
    return {
      responsePreference: null,
      activeTargetId: null
    };
  }

  return {
    responsePreference: nextPreference,
    activeTargetId: targetId
  };
}

export function isFeedbackPreferenceActive(
  currentState: FeedbackSelectionState,
  targetId: string,
  preference: Exclude<ResponsePreference, null>
) {
  return (
    currentState.responsePreference === preference &&
    currentState.activeTargetId === targetId
  );
}
