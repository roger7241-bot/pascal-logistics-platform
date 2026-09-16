// ============================================================================
// ClientDocumentsPage
// Self-serve document upload for the client. Drag-drop / browse to pick a
// file, categorize it, upload directly to S3 via presigned PUT, confirm to
// the server, appear in the list below. Roger's Sanitizer (Agent 1) picks it
// up from vault_documents on the next run.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { FileStack, Upload, Loader2, AlertCircle, FileText, Download } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "commercial_invoice", label: "Commercial invoice" },
  { value: "packing_list", label: "Packing list" },
  { value: "usmca_certificate", label: "USMCA certificate of origin" },
  { value: "poa", label: "Power of attorney" },
  { value: "bill_of_lading", label: "Bill of lading" },
  { value: "sds", label: "Safety data sheet (SDS)" },
  { value: "other", label: "Other" },
];
// Server validates against a smaller subset — filter client options down
// to categories the server accepts.
const SERVER_VALID = new Set(["commercial_invoice", "poa", "bill_of_lading", "sds", "usmca_certificate", "other"]);
const UI_CATEGORIES = CATEGORIES.filter((c) => SERVER_VALID.has(c.value));

interface Doc {
  id: string;
  filename: string;
  category: string;
  uploaded_at: string;
  s3_key: string | null;
}

export function ClientDocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [category, setCategory] = useState<string>(UI_CATEGORIES[0].value);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const d = await api.listDocuments<{ documents: Doc[] }>("client");
      setDocs(d.documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const contentType = file.type || "application/octet-stream";
      const signed = await api.requestUploadUrl<{ uploadUrl: string; objectKey: string; simulated: boolean }>("client", {
        filename: file.name,
        category,
        contentType,
      });
      if (!signed.simulated) {
        const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
        if (!put.ok) throw new Error(`S3 upload failed: HTTP ${put.status}`);
      } else {
        setNotice("S3 credentials aren't set on the server yet — file recorded but not stored. Roger will follow up.");
      }
      await api.confirmUpload("client", { objectKey: signed.objectKey, filename: file.name, category });
      setFile(undefined);
      // clear file input value
      const el = document.getElementById("doc-file-input") as HTMLInputElement | null;
      if (el) el.value = "";
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function download(id: string, filename: string) {
    try {
      const signed = await api.documentDownloadUrl<{ downloadUrl: string; simulated: boolean }>("client", id);
      if (signed.simulated) {
        setNotice(`This document isn't backed by real S3 storage yet — link is a placeholder. (${filename})`);
        return;
      }
      window.open(signed.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download link failed.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <FileStack size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Documents</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">Shared with Pascal</span>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{notice}</span>
          </div>
        )}

        {/* Upload form */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">Upload a document</p>
            <a href="/client-portal/documents/generate" className="text-[11px] font-medium text-cyan-700 hover:underline">
              Or generate a BOL / Commercial Invoice / USMCA Cert →
            </a>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <input id="doc-file-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? undefined)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              {UI_CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
            </select>
            <button onClick={upload} disabled={!file || uploading} className="flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Files upload directly to our encrypted vault. Roger's team is auto-notified.</p>
        </section>

        {/* Documents list */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold text-slate-900">On file</p>
            <p className="text-[11px] text-slate-500">{docs.length} documents</p>
          </div>
          {loading && docs.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Loading…</div>
          ) : docs.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-500">No documents uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={14} className="text-slate-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{d.filename}</p>
                      <p className="text-[10px] text-slate-500">{d.category.replace(/_/g, " ")} · {new Date(d.uploaded_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {d.s3_key && (
                    <button onClick={() => download(d.id, d.filename)} className="flex flex-shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                      <Download size={11} /> Download
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
