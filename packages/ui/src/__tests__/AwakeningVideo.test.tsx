import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AwakeningVideo } from "../AwakeningVideo";

describe("AwakeningVideo", () => {
  it("renders a muted, autoplay, playsInline video with the provided sources", () => {
    const { container } = render(
      <AwakeningVideo
        sources={["https://cdn/x.webm", "https://cdn/x.mp4"]}
        onNearEnd={() => {}}
        onEnded={() => {}}
      />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();

    const sources = container.querySelectorAll("source");
    expect(sources.length).toBe(2);
    expect(sources[0].getAttribute("src")).toBe("https://cdn/x.webm");
    expect(sources[0].getAttribute("type")).toBe("video/webm");
    expect(sources[1].getAttribute("src")).toBe("https://cdn/x.mp4");
    expect(sources[1].getAttribute("type")).toBe("video/mp4");
  });

  it("calls onEnded when the video element fires ended", () => {
    const onEnded = vi.fn();
    const { container } = render(
      <AwakeningVideo sources={["https://cdn/x.mp4"]} onNearEnd={() => {}} onEnded={onEnded} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("calls onEnded when the video element fires error (e.g., all sources 404)", () => {
    const onEnded = vi.fn();
    const { container } = render(
      <AwakeningVideo sources={["https://cdn/missing.webm", "https://cdn/missing.mp4"]} onNearEnd={() => {}} onEnded={onEnded} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.error(video);
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("calls onNearEnd once when currentTime enters the last 500ms of the video", () => {
    const onNearEnd = vi.fn();
    const { container } = render(
      <AwakeningVideo sources={["https://cdn/x.mp4"]} onNearEnd={onNearEnd} onEnded={() => {}} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    // Stub duration + currentTime since jsdom doesn't have real playback
    Object.defineProperty(video, "duration", { value: 1.5, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0.5, configurable: true, writable: true });
    fireEvent.timeUpdate(video);
    expect(onNearEnd).not.toHaveBeenCalled();

    // Advance to within the near-end window
    Object.defineProperty(video, "currentTime", { value: 1.1, configurable: true, writable: true });
    fireEvent.timeUpdate(video);
    expect(onNearEnd).toHaveBeenCalledOnce();

    // Further timeupdate events shouldn't re-fire
    Object.defineProperty(video, "currentTime", { value: 1.4, configurable: true, writable: true });
    fireEvent.timeUpdate(video);
    expect(onNearEnd).toHaveBeenCalledOnce();
  });

  it("does not fire onNearEnd when duration is NaN (metadata still loading)", () => {
    const onNearEnd = vi.fn();
    const { container } = render(
      <AwakeningVideo sources={["https://cdn/x.mp4"]} onNearEnd={onNearEnd} onEnded={() => {}} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: NaN, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, configurable: true, writable: true });
    fireEvent.timeUpdate(video);
    expect(onNearEnd).not.toHaveBeenCalled();
  });
});
