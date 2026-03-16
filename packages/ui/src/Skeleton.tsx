import React from "react";

/** A single pulsing skeleton bar */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-white/5 animate-pulse rounded-lg ${className}`} />
  );
}

/** Skeleton that mimics a ThingCard — icon circle + two text lines + badge */
function SkeletonThingCard() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/5">
      <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonBar className="h-3.5 w-3/4" />
        <SkeletonBar className="h-2.5 w-1/2" />
      </div>
      <SkeletonBar className="h-6 w-16 rounded-full" />
    </div>
  );
}

/** Skeleton for a list/inbox view — header + add input + 3-4 item cards */
export function SkeletonListView() {
  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 mb-4">
        <SkeletonBar className="w-5 h-5 rounded-full" />
        <SkeletonBar className="h-5 w-32" />
      </div>

      {/* Add input skeleton */}
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-transparent mb-3">
        <SkeletonBar className="w-4 h-4 rounded-full" />
        <SkeletonBar className="h-3.5 w-24" />
      </div>

      {/* Section header skeleton */}
      <div className="flex items-center gap-3 mb-2">
        <SkeletonBar className="h-2.5 w-12" />
        <div className="h-px bg-white/5 flex-1" />
      </div>

      {/* Thing card skeletons */}
      <div className="flex flex-col gap-2">
        <SkeletonThingCard />
        <SkeletonThingCard />
        <SkeletonThingCard />
      </div>
    </div>
  );
}
