import { useEffect, useState } from "react";
import { FolderOpen, Upload, Loader2, FileText, Download } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface VaultDocument {
  id: string;
  filename: string;
  category: string;
  extractedFields?: Record<string, unknown>;
  uploadedAt: string;
  hasStoredFile: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  commercial_invoice: "Commercial Invoice",
  poa: "Power of Attorney",
  bill_of_lading: "Bill of Lading",
  sds: "SDS Sheet",
  usmca_certificate: "USMCA Certificate",
  other: "Other",
};

export function DocumentVaultPage() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filename, setFilename] = useState("");
  const [category, setCategory] = useState("commercial_invoice");
  const [documentText, setDocumentText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | undefined>();
  const [downloadError, setDownloadError] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    api
      .vault<{ documents: VaultDocument[] }>()
      .then((d) => setDocuments(d.documents))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleUpload = async () => {
    if (!filename.trim()) return;
    setUploading(true);
    try {
      await api.uploadVaultDocument({ orgId: "org_meridian", filename, category, documentText: documentText.trim() || undefined });
      setFilename("");
      setDocumentText("");
      load();
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: VaultDocument) => {
    setDownloading(doc.id);
    setDownloadError((prev) => ({ ...prev, [doc.id]: "" }));
    try {
      const signed = await api.vaultDownloadUrl<{ url: string; simulated: boolean; expiresInSeconds: number }>(doc.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setDownloadError((prev) => ({ ...prev, [doc.id]: err instanceof Error ? err.message : "Download failed." }));
    } finally {
      setDownloading(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <FolderOpen size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Document Vault &amp; OCR Intake</h1>
        </div>

        <div className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="Filename" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={documentText}
            onChange={(e) => setDocumentText(e.target.value)}
            placeholder="Paste document text to run real Claude extraction (optional)..."
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          />
          <button onClick={handleUpload} disabled={uploading} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ? "Uploading..." : "Upload to vault"}
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">Vault documents {loading && <span className="text-slate-400">(loading...)</span>}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {documents.map((doc) => (
              <div key={doc.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <FileText size={14} className="shrink-0 text-slate-400" />
                  <p className="flex-1 text-sm font-semibold text-slate-900">{doc.filename}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{CATEGORY_LABEL[doc.category]}</span>
                  {doc.hasStoredFile ? (
                    <button
                      onClick={() => handleDownload(doc)}
                      disabled={downloading === doc.id}
                      className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Download size={11} /> {downloading === doc.id ? "Signing…" : "Download"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-300">No file stored</span>
                  )}
                </div>
                {doc.extractedFields && Object.keys(doc.extractedFields).length > 0 && (
                  <p className="mt-1.5 pl-6 text-xs text-slate-500">Extracted: {JSON.stringify(doc.extractedFields)}</p>
                )}
                {downloadError[doc.id] && <p className="mt-1.5 pl-6 text-xs text-rose-600">{downloadError[doc.id]}</p>}
              </div>
            ))}
            {!loading && documents.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No documents in the vault yet.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
