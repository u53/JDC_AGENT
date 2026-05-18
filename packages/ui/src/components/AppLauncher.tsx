import { useState, useEffect, useRef } from "react";
import { IconExternalLink } from "./icons";

interface DetectedApp {
  id: string;
  name: string;
  available: boolean;
}

interface Props {
  cwd: string;
}

export function AppLauncher({ cwd }: Props) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<DetectedApp[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electronAPI?.appsDetect().then((result: { apps: DetectedApp[] }) => {
      setApps(result.apps);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openApp = async (appId: string) => {
    await window.electronAPI?.appsOpen(appId, cwd);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-[6px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        aria-label="Open in..."
      >
        <IconExternalLink size={14} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[180px] bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg z-50 overflow-hidden py-1">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => openApp(app.id)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] text-left"
            >
              {app.name}
            </button>
          ))}
          {apps.length === 0 && (
            <span className="px-3 py-1.5 text-[12px] text-[var(--muted)]">
              未检测到应用
            </span>
          )}
        </div>
      )}
    </div>
  );
}
