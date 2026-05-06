import { describe, expect, it } from "vitest";
import {
  getNextFeedbackSelection,
  isFeedbackPreferenceActive,
  type FeedbackSelectionState
} from "../sidebar/feedback";

describe("feedback selection", () => {
  it("only keeps the clicked toolbar active", () => {
    const initialState: FeedbackSelectionState = {
      responsePreference: null,
      activeTargetId: null
    };

    const likedState = getNextFeedbackSelection(initialState, "timeline-1", "liked");

    expect(isFeedbackPreferenceActive(likedState, "timeline-1", "liked")).toBe(true);
    expect(isFeedbackPreferenceActive(likedState, "timeline-2", "liked")).toBe(false);
  });

  it("allows clicking the same preference again to clear it", () => {
    const likedState: FeedbackSelectionState = {
      responsePreference: "liked",
      activeTargetId: "result-main"
    };

    expect(getNextFeedbackSelection(likedState, "result-main", "liked")).toEqual({
      responsePreference: null,
      activeTargetId: null
    });
  });

  it("moves the active feedback state to a new target when switching cards", () => {
    const currentState: FeedbackSelectionState = {
      responsePreference: "liked",
      activeTargetId: "timeline-1"
    };

    expect(getNextFeedbackSelection(currentState, "timeline-2", "disliked")).toEqual({
      responsePreference: "disliked",
      activeTargetId: "timeline-2"
    });
  });
});
