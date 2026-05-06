import { describe, expect, it } from "vitest";
import {
  calculateFrameSampleTimes,
  calculateFrameSignatureSimilarity,
  isPausedVideo,
  normalizeRequestedFrameTimes
} from "../lib/frameCapture";

describe("isPausedVideo", () => {
  it("returns true for paused HTML video elements", () => {
    const video = { paused: true } as HTMLVideoElement;
    expect(isPausedVideo(video)).toBe(true);
  });
});

describe("calculateFrameSampleTimes", () => {
  it("samples long videos across the whole duration without exceeding the cap", () => {
    const times = calculateFrameSampleTimes(2591, 18);

    expect(times).toHaveLength(18);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(2591);
    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it("uses one midpoint sample for very short videos", () => {
    expect(calculateFrameSampleTimes(20, 18)).toEqual([10]);
  });

  it("normalizes requested frame times within duration and cap", () => {
    expect(normalizeRequestedFrameTimes([14, 13, -1, 13, 42], 20, 3)).toEqual([13, 14]);
  });

  it("calculates thumbnail signature similarity for frame dedupe", () => {
    expect(calculateFrameSignatureSimilarity([0, 10, 20], [0, 10, 20])).toBe(1);
    expect(calculateFrameSignatureSimilarity([0, 0, 0], [255, 255, 255])).toBe(0);
  });
});
