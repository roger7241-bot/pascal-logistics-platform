import { useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

/** Public, unauthenticated mobile page reached by scanning the QR code
 * generated in RapidDispatchDesk. Deliberately outside any login flow —
 * this is what a forklift operator's own phone camera opens. */
export function MagicUploadPage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleFileSelected(file: File) {
    if (!token) return;
    setStatus("uploading");
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch(`${API_BASE_URL}/api/v1/magic-upload/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, imageBase64 }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${response.status})`);
      }
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center text-slate-900">
      <p className="mb-1 text-lg font-bold">Pascal Logistics</p>
      <p className="mb-8 text-sm text-slate-500">Signed BOL / Packing Slip Upload</p>

      {status === "idle" && (
        <label className="flex w-full max-w-xs cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white p-8">
          <Camera size={32} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">Tap to take a photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
            }}
          />
        </label>
      )}

      {status === "uploading" && (
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-sm">Uploading…</p>
        </div>
      )}

      {status === "done" && (
        <div className="flex flex-col items-center gap-3 text-emerald-600">
          <CheckCircle2 size={36} />
          <p className="text-sm font-semibold">Photo received — thank you.</p>
          <p className="text-xs text-slate-400">You can close this page.</p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-rose-600">{errorMessage}</p>
          <button onClick={() => setStatus("idle")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
