import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "wouter";
import QRCode from "qrcode";
import QrScanner from "qr-scanner";
import { Download, ImageUp, QrCode, ScanLine, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseScannedCode, userQrUrl, type ScannedCode } from "@/lib/pay-qr";
import { CopyIcon, OutlineButton, PrimaryButton } from "./ui";

// "My QR code" (a user's fixed code for collecting money) and the in-app scanner.

export function QrDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[rgb(11_18_32/.55)] grid place-items-center p-4">
      <motion.div role="dialog" aria-modal="true" aria-label={title}
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[400px] max-h-[calc(100dvh-32px)] overflow-y-auto bg-white rounded-[26px] p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-xl tracking-[-0.02em]">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 rounded-xl grid place-items-center text-(--sw-muted) hover:bg-(--sw-bg)">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

const qrOptions = (width: number, level: "M" | "H") =>
  ({ width, margin: 2, errorCorrectionLevel: level, color: { dark: "#0b1220", light: "#ffffff" } }) as const;

function useQrDataUrl(value: string, width: number, level: "M" | "H" = "M") {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, qrOptions(width, level))
      .then((url) => { if (live) setSrc(url); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [value, width, level]);
  return src;
}

/** Save a QR code for `value` as a PNG. */
export async function downloadQr(value: string, fileName: string) {
  const a = document.createElement("a");
  a.href = await QRCode.toDataURL(value, qrOptions(1024, "M"));
  a.download = fileName;
  a.click();
}

/** A QR code with the Sweep mark in the middle (high error correction keeps it scannable). */
export function BrandedQr({ value, label, className }: { value: string; label: string; className?: string }) {
  const src = useQrDataUrl(value, 480, "H");
  return (
    <div className={cn("relative aspect-square rounded-2xl border border-(--sw-line) bg-white p-1.5 shrink-0", className)}>
      {src ? <img src={src} alt={label} className="w-full h-full" /> : <div className="w-full h-full rounded-xl bg-(--sw-bg) animate-pulse" />}
      <span aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[20%] aspect-square rounded-[22%] bg-(--sw-blue) grid place-items-center ring-[3px] ring-white">
        <img src="/sweep-mark-white.svg" alt="" className="w-1/2" />
      </span>
    </div>
  );
}

/** A QR code with download (and share, where the device supports it). */
export function ShareableQr({ value, label, sublabel, fileName, shareText }: {
  value: string;
  label: string;
  sublabel?: ReactNode;
  fileName: string;
  shareText: string;
}) {
  const src     = useQrDataUrl(value, 640);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const download = () => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = fileName;
    a.click();
  };
  const share = () => navigator.share?.({ title: "Sweep", text: shareText, url: value }).catch(() => {});

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-[260px] aspect-square rounded-[22px] border border-(--sw-line) p-3 grid place-items-center bg-white">
        {src ? <img src={src} alt={`QR code: ${label}`} className="w-full h-full" /> : <div className="w-full h-full rounded-xl bg-(--sw-bg) animate-pulse" />}
      </div>
      <div className="flex flex-col items-center gap-0.5 min-w-0 max-w-full text-center">
        <span className="font-extrabold text-[17px] tracking-[-0.01em] truncate max-w-full">{label}</span>
        {sublabel}
      </div>
      <div className={cn("grid gap-2.5 w-full", canShare ? "grid-cols-2" : "grid-cols-1")}>
        <OutlineButton onClick={download} disabled={!src} className="h-12 flex items-center justify-center gap-2">
          <Download className="w-4 h-4" /> Download
        </OutlineButton>
        {canShare && (
          <PrimaryButton onClick={share} className="h-12 text-[15px]">
            <Share2 className="w-4 h-4" /> Share
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

export function MyQrCode({ name, paymentId }: { name: string; paymentId: string }) {
  return (
    <>
      <p className="text-sm text-(--sw-muted) -mt-2">Anyone on Sweep can scan this to pay you. It's your payment ID, so it never changes.</p>
      <ShareableQr
        value={userQrUrl(paymentId)}
        label={name}
        sublabel={
          <span className="flex items-center gap-1 text-[13px] font-semibold text-(--sw-blue) min-w-0 max-w-full">
            <span className="truncate">{paymentId}</span>
            <CopyIcon text={paymentId} label="Copy payment ID" />
          </span>
        }
        fileName="sweep-payment-qr.png"
        shareText={`Pay me on Sweep: ${paymentId}`}
      />
    </>
  );
}

/** Camera scanner with a photo-upload fallback. Calls onScan once with a valid Sweep code. */
export function QrScanView({ onScan }: { onScan: (code: ScannedCode) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);
  const doneRef  = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notSweep,    setNotSweep]    = useState(false);

  const handle = (text: string) => {
    if (doneRef.current) return;
    const code = parseScannedCode(text);
    if (!code) { setNotSweep(true); return; }
    doneRef.current = true;
    onScan(code);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, (r) => handle(r.data), {
      preferredCamera: "environment",
      highlightScanRegion: false,
      maxScansPerSecond: 8,
      returnDetailedScanResult: true,
    });
    scanner.start().catch((e: unknown) => {
      const msg = String((e as any)?.name ?? e);
      setCameraError(/NotAllowed|Permission/i.test(msg)
        ? "Camera access was blocked. Allow it in your browser settings, or upload a photo of the code."
        : "No camera available. Upload a photo of the code instead.");
    });
    return () => { scanner.stop(); scanner.destroy(); };
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setNotSweep(false);
    try {
      const r = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      handle(r.data);
    } catch {
      setNotSweep(true);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative w-full aspect-square rounded-[22px] overflow-hidden bg-[#0b1220]">
        <video ref={videoRef} muted playsInline className={cn("w-full h-full object-cover", cameraError && "hidden")} />
        {cameraError ? (
          <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm font-medium text-white/85">{cameraError}</p>
        ) : (
          <div aria-hidden className="absolute inset-[18%] rounded-[20px] border-[3px] border-white/90 shadow-[0_0_0_999px_rgb(11_18_32/.35)]" />
        )}
      </div>
      <p className={cn("text-sm text-center font-medium", notSweep ? "text-[#b42318]" : "text-(--sw-muted)")} role="status">
        {notSweep ? "That isn't a Sweep code. Scan a Sweep payment or merchant QR code." : "Point your camera at a Sweep QR code."}
      </p>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <OutlineButton onClick={() => fileRef.current?.click()} className="h-12 flex items-center justify-center gap-2">
        <ImageUp className="w-4 h-4" /> Upload a photo
      </OutlineButton>
    </div>
  );
}

/**
 * Wires the scanner and "My QR code" dialogs into a dashboard shell.
 * A scanned user code calls onPayUser; a merchant code opens that plan's checkout.
 */
export function usePayQr({ name, paymentId, onPayUser }: {
  name: string;
  paymentId: string;
  onPayUser: (paymentId: string) => void;
}) {
  const [open, setOpen] = useState<"scan" | "mine" | null>(null);
  const [, setLocation] = useLocation();
  const close = () => setOpen(null);

  const onScan = (code: ScannedCode) => {
    setOpen(null);
    if (code.kind === "merchant") setLocation(`/subscribe/${code.merchantId}`);
    else onPayUser(code.paymentId); // the send form flags the user's own ID
  };

  const dialogs = (
    <AnimatePresence>
      {open === "scan" && <QrDialog key="scan" title="Scan to pay" onClose={close}><QrScanView onScan={onScan} /></QrDialog>}
      {open === "mine" && <QrDialog key="mine" title="My QR code" onClose={close}><MyQrCode name={name} paymentId={paymentId} /></QrDialog>}
    </AnimatePresence>
  );

  return { openScan: () => setOpen("scan"), openMyQr: () => setOpen("mine"), dialogs };
}

export function QrIconButton({ kind, onClick, className }: { kind: "scan" | "mine"; onClick: () => void; className?: string }) {
  const label = kind === "scan" ? "Scan a QR code" : "Show my QR code";
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn("w-8 h-8 rounded-[10px] grid place-items-center text-(--sw-blue) hover:bg-(--sw-tint) transition-colors shrink-0", className)}>
      {kind === "scan" ? <ScanLine className="w-[18px] h-[18px]" /> : <QrCode className="w-[18px] h-[18px]" />}
    </button>
  );
}
