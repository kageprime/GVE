import { memo, useEffect, useRef, useState } from "react";
import SceneViewer from "../SceneViewer";
import { InlineArtifactCard } from "./InlineArtifactCard";

interface InlineScenePreviewProps {
  code: string;
  skill: string;
  sceneId: string;
  versionId: string;
  onExpand?: () => void;
  streaming?: boolean;
}

const InlineScenePreviewInner = memo(function InlineScenePreviewInner({
  code,
  skill,
  sceneId,
  versionId,
  onExpand,
  streaming = false,
}: InlineScenePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (mountedRef.current) setIsVisible(entry.isIntersecting); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => {
      mountedRef.current = false;
      observer.disconnect();
    };
  }, []);

  return (
    <InlineArtifactCard
      sceneId={sceneId}
      skill={skill}
    >
      <div ref={containerRef} className="relative aspect-[16/10] w-full overflow-hidden">
        <SceneViewer
          key={`inline-${versionId}-${sceneId}`}
          code={code}
          skill={skill}
          onExpand={onExpand}
          streaming={streaming}
          paused={!isVisible}
        />
      </div>
    </InlineArtifactCard>
  );
}, (prev, next) => {
  return (
    prev.code === next.code &&
    prev.skill === next.skill &&
    prev.sceneId === next.sceneId &&
    prev.versionId === next.versionId &&
    prev.streaming === next.streaming
  );
});

export function InlineScenePreview(props: InlineScenePreviewProps) {
  return <InlineScenePreviewInner {...props} />;
}
