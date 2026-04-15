import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AwakeningVideo } from "../AwakeningVideo";

describe("AwakeningVideo", () => {
  it("renders a muted, autoplay, playsInline video with the provided sources", () => {
    const { container } = render(
      <AwakeningVideo
        sources={["https://cdn/x.webm", "https://cdn/x.mp4"]}
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
      <AwakeningVideo sources={["https://cdn/x.mp4"]} onEnded={onEnded} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    video.dispatchEvent(new Event("ended"));
    expect(onEnded).toHaveBeenCalledOnce();
  });
});
