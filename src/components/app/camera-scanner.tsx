"use client";

/**
 * The camera, once, for both QR pages.
 *
 * It used to live inside `ScanArrivals`, which is why `/app/check-in` showed a
 * decorative dark rectangle with the words "Ready to scan" and no camera
 * behind it: the desk page had the copy of a scanner and none of the parts.
 * Both pages now render this component.
 *
 * ## Why there are three attempts
 *
 * `{ facingMode: "environment" }` asks for the rear camera, which is the right
 * lens on a phone held over a guest's pass. On a laptop it is a request for a
 * camera that usually does not exist, and the browser answers with
 * `OverconstrainedError` or `NotFoundError` — so the scan silently never
 * starts, which is exactly the "camera not working" the desk reported. The
 * fallback chain is: rear lens, then the first camera the browser will name,
 * then the default lens. Only when all three fail is the camera really
 * unavailable, and then the reason is said out loud.
 */

import * as React from "react";
import { Camera, CameraOff } from "lucide-react";

type Status = "starting" | "live" | "blocked" | "unsupported";

type Scanner = {
  start: (
    target: { facingMode: string } | string,
    config: { fps: number; qrbox: { width: number; height: number } },
    onDecode: (decoded: string) => void,
    onFrame: () => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
};

/**
 * Close a scanner without ever throwing.
 *
 * `Html5Qrcode.stop()` throws **synchronously** — not as a rejected promise —
 * when the instance never reached "scanning": camera permission denied, no
 * device, or a start that is still in flight. Called from an effect cleanup,
 * that throw propagates out of unmount and React tears down the tree, which is
 * the "Cannot stop, scanner is not running or paused" crash seen after leaving
 * a camera page on a device that refused the camera. So the call is wrapped,
 * and the promise branch keeps its own guard for the rejecting case.
 */
function stopScanner(scanner: Scanner | null) {
  if (!scanner) return;
  try {
    Promise.resolve(scanner.stop())
      .then(() => {
        try {
          scanner.clear();
        } catch {
          /* the region is already gone */
        }
      })
      .catch(() => undefined);
  } catch {
    try {
      scanner.clear();
    } catch {
      /* nothing was rendered */
    }
  }
}

export function CameraScanner({
  onCode,
  paused,
  className,
  hint,
}: {
  onCode: (raw: string) => void;
  paused: boolean;
  className?: string;
  hint?: string;
}) {
  const regionId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const [status, setStatus] = React.useState<Status>("starting");
  const [reason, setReason] = React.useState<string>("");
  const scannerRef = React.useRef<Scanner | null>(null);
  const onCodeRef = React.useRef(onCode);
  onCodeRef.current = onCode;
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        setReason(
          "This browser does not expose a camera to the page. Most browsers only allow it on https:// or on localhost.",
        );
        return;
      }

      const config = { fps: 10, qrbox: { width: 230, height: 230 } };
      const onDecode = (decoded: string) => {
        // The library fires on every frame that decodes. Without this guard one
        // pass in front of the lens would fire dozens of lookups.
        if (pausedRef.current) return;
        onCodeRef.current(decoded);
      };
      const onFrame = () => {
        /* per-frame "nothing found" — not an error worth showing */
      };

      let Html5Qrcode: typeof import("html5-qrcode").Html5Qrcode;
      try {
        // Imported lazily: the library touches navigator at load time, and
        // there is no reason to ship it to anyone who never opens this page.
        ({ Html5Qrcode } = await import("html5-qrcode"));
      } catch {
        if (!cancelled) {
          setStatus("blocked");
          setReason("The scanner could not be loaded. Use the reference box below.");
        }
        return;
      }
      if (cancelled) return;

      /**
       * A fresh instance per attempt — a failed start leaves one unusable.
       *
       * The instance is parked in the ref *before* start, so a navigation that
       * happens mid-start still has something to stop. If the start lands after
       * the page has gone, the camera it just opened is closed here instead of
       * being left running with no component behind it.
       */
      const attempt = async (target: { facingMode: string } | string) => {
        const scanner = new Html5Qrcode(regionId, { verbose: false }) as unknown as Scanner;
        scannerRef.current = scanner;
        try {
          await scanner.start(target, config, onDecode, onFrame);
        } catch (err) {
          // A rejected start can still have acquired the stream.
          stopScanner(scanner);
          if (scannerRef.current === scanner) scannerRef.current = null;
          throw err;
        }
        if (cancelled) {
          if (scannerRef.current === scanner) scannerRef.current = null;
          stopScanner(scanner);
        }
      };

      try {
        await attempt({ facingMode: "environment" });
      } catch (first) {
        if (cancelled) return;
        const name = (first as { name?: string })?.name ?? "";

        // A denied permission is final: asking again just fails again.
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setStatus("blocked");
          setReason(
            "Camera access was denied. Allow it in your browser's address bar, then reload — or type the pass below.",
          );
          return;
        }

        try {
          const cameras = await Html5Qrcode.getCameras().catch(() => []);
          if (cancelled) return;
          if (cameras.length > 0) {
            await attempt(cameras[0].id);
          } else {
            // No named device: let the browser pick whatever it considers
            // default rather than pinning a facing mode it cannot satisfy.
            await attempt({ facingMode: "user" });
          }
        } catch (second) {
          if (cancelled) return;
          const name2 = (second as { name?: string })?.name ?? "";
          setStatus("blocked");
          setReason(
            name2 === "NotAllowedError" || name2 === "PermissionDeniedError"
              ? "Camera access was denied. Allow it in your browser's address bar, then reload — or type the pass below."
              : name2 === "NotFoundError" || name2 === "DevicesNotFoundError"
                ? "No camera was found on this device. Use the pass box below."
                : "The camera could not be started on this device. Use the pass box below.",
          );
          return;
        }
      }

      if (!cancelled) setStatus("live");
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      stopScanner(scanner);
    };
  }, [regionId]);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-foreground/90">
        <div id={regionId} className="[&_video]:!w-full [&_video]:!rounded-xl [&_video]:object-cover" />

        {status !== "live" && (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 px-6 text-center">
            {status === "starting" ? (
              <>
                <Camera className="size-6 text-background/70" />
                <p className="text-[12.5px] text-background/70">Starting the camera…</p>
              </>
            ) : (
              <>
                <CameraOff className="size-6 text-background/70" />
                <p className="max-w-xs text-[12.5px] leading-relaxed text-background/70">{reason}</p>
              </>
            )}
          </div>
        )}

        {status === "live" && (
          // A frame over the live video. It is a guide, not a crop — the
          // library decodes the whole frame, so a guest holding the pass a
          // little off-centre is still read.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative size-[230px] max-w-[70%]">
              {(
                [
                  "left-0 top-0 border-l-2 border-t-2 rounded-tl-lg",
                  "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg",
                  "left-0 bottom-0 border-b-2 border-l-2 rounded-bl-lg",
                  "right-0 bottom-0 border-b-2 border-r-2 rounded-br-lg",
                ] as const
              ).map((c) => (
                <span key={c} className={`absolute size-8 border-background/90 ${c}`} />
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
        <Camera className="mt-0.5 size-3.5 shrink-0" />
        {hint ??
          (status === "live"
            ? "Hold the guest's arrival pass inside the frame. The code is read automatically."
            : "If the camera is unavailable, the box below does the same job.")}
      </p>
    </div>
  );
}
