// ============================================================================
// ClientDocumentGeneratorPage
// One-click generation of the three highest-volume freight documents from
// shipment data. Downloads the PDF via a direct fetch (credentials
// included so the auth cookie flows) and hands it to the browser.
// ============================================================================

import { useState } from "react";
import { FileText, Download, Loader2, AlertCircle, Ship, ScrollText, FileCheck } from "lucide-react";
import { AppHeader } from "../components/AppHeader";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

type DocKind = "bol" | "commercial_invoice" | "usmca_cert";

async function downloadPdf(path: string, body: unknown, filenameFallback: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    const err = contentType.includes("application/json") ? (await res.json())?.error : `HTTP ${res.status}`;
    throw new Error(err ?? "Download failed.");
  }
  const disp = res.headers.get("content-disposition") ?? "";
  const match = disp.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? filenameFallback;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ClientDocumentGeneratorPage() {
  const [kind, setKind] = useState<DocKind>("bol");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // BOL state
  const [bolNumber, setBolNumber] = useState(`BOL-${Date.now().toString().slice(-6)}`);
  const [bolShipperName, setBolShipperName] = useState("");
  const [bolShipperCity, setBolShipperCity] = useState("");
  const [bolConsigneeName, setBolConsigneeName] = useState("");
  const [bolConsigneeCity, setBolConsigneeCity] = useState("");
  const [bolCarrier, setBolCarrier] = useState("");
  const [bolProNumber, setBolProNumber] = useState("");
  const [bolLineDescription, setBolLineDescription] = useState("General merchandise, palletized");
  const [bolLinePieces, setBolLinePieces] = useState("4");
  const [bolLineWeightLb, setBolLineWeightLb] = useState("2400");
  const [bolLineClass, setBolLineClass] = useState("70");
  const [bolIsHazmat, setBolIsHazmat] = useState(false);
  const [bolTerms, setBolTerms] = useState<"prepaid" | "collect" | "third_party">("prepaid");

  // Commercial invoice state
  const [ciNumber, setCiNumber] = useState(`CI-${Date.now().toString().slice(-6)}`);
  const [ciSoldByName, setCiSoldByName] = useState("");
  const [ciSoldToName, setCiSoldToName] = useState("");
  const [ciShipToName, setCiShipToName] = useState("");
  const [ciIncoterm, setCiIncoterm] = useState("FOB");
  const [ciIncotermPlace, setCiIncotermPlace] = useState("Shanghai");
  const [ciCurrency, setCiCurrency] = useState("USD");
  const [ciLineDesc, setCiLineDesc] = useState("Widgets, industrial grade");
  const [ciLineHs, setCiLineHs] = useState("8471.30");
  const [ciLineOrigin, setCiLineOrigin] = useState("CN");
  const [ciLinePieces, setCiLinePieces] = useState("120");
  const [ciLineUnitValue, setCiLineUnitValue] = useState("42.50");

  // USMCA cert state
  const [ucCertifierType, setUcCertifierType] = useState<"importer" | "exporter" | "producer">("exporter");
  const [ucCertifierName, setUcCertifierName] = useState("");
  const [ucGoodDesc, setUcGoodDesc] = useState("");
  const [ucGoodHs, setUcGoodHs] = useState("8471.30");
  const [ucGoodCriterion, setUcGoodCriterion] = useState<"A" | "B" | "C" | "D">("B");
  const [ucGoodOrigin, setUcGoodOrigin] = useState("US");
  const [ucSignatoryName, setUcSignatoryName] = useState("");
  const [ucSignatoryTitle, setUcSignatoryTitle] = useState("");

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      if (kind === "bol") {
        const totalValue = 0;
        await downloadPdf("/api/client/documents/generate/bol", {
          bolNumber,
          shipDate: new Date().toISOString().slice(0, 10),
          shipper: { name: bolShipperName, city: bolShipperCity },
          consignee: { name: bolConsigneeName, city: bolConsigneeCity },
          carrierName: bolCarrier,
          proNumber: bolProNumber || undefined,
          freightTermsPrepaidOrCollect: bolTerms,
          isHazmat: bolIsHazmat,
          lines: [{
            pieces: Number(bolLinePieces),
            packageType: "pallets",
            description: bolLineDescription,
            weightLb: Number(bolLineWeightLb),
            nmfcClass: bolLineClass,
            totalValueUsd: totalValue,
          }],
        }, `BOL_${bolNumber}.pdf`);
      } else if (kind === "commercial_invoice") {
        const pieces = Number(ciLinePieces);
        const unit = Number(ciLineUnitValue);
        const lineTotal = pieces * unit;
        await downloadPdf("/api/client/documents/generate/commercial-invoice", {
          invoiceNumber: ciNumber,
          invoiceDate: new Date().toISOString().slice(0, 10),
          soldBy: { name: ciSoldByName },
          soldTo: { name: ciSoldToName },
          shipTo: { name: ciShipToName },
          incoterm: ciIncoterm,
          incotermPlace: ciIncotermPlace,
          currency: ciCurrency,
          reasonForExport: "sale",
          lines: [{
            pieces, description: ciLineDesc, hsCode: ciLineHs, countryOfOrigin: ciLineOrigin,
            unitValueUsd: unit, totalValueUsd: lineTotal,
          }],
          totalPieces: pieces,
          totalWeightKg: 0,
          totalValueUsd: lineTotal,
        }, `CommercialInvoice_${ciNumber}.pdf`);
      } else {
        await downloadPdf("/api/client/documents/generate/usmca-cert", {
          certifierType: ucCertifierType,
          certifierParty: { name: ucCertifierName },
          goods: [{
            description: ucGoodDesc, hsCode: ucGoodHs,
            originCriterion: ucGoodCriterion, countryOfOrigin: ucGoodOrigin,
          }],
          authorizedSignatoryName: ucSignatoryName,
          authorizedSignatoryTitle: ucSignatoryTitle || undefined,
          signedOn: new Date().toISOString().slice(0, 10),
        }, "USMCA_Cert.pdf");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Generate freight documents</h1>
        </div>
        <p className="text-sm text-slate-600">Fillable PDFs generated from your shipment data. Sign and email; keep the copy for your records.</p>

        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {[
            { k: "bol" as const, label: "Bill of Lading", icon: Ship },
            { k: "commercial_invoice" as const, label: "Commercial Invoice", icon: ScrollText },
            { k: "usmca_cert" as const, label: "USMCA Certificate", icon: FileCheck },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.k} onClick={() => setKind(t.k)} className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium ${kind === t.k ? "border-cyan-500 bg-slate-50 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {kind === "bol" && (
            <div className="grid grid-cols-2 gap-3">
              <input value={bolNumber} onChange={(e) => setBolNumber(e.target.value)} placeholder="BOL number" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolCarrier} onChange={(e) => setBolCarrier(e.target.value)} placeholder="Carrier name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolShipperName} onChange={(e) => setBolShipperName(e.target.value)} placeholder="Shipper name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolShipperCity} onChange={(e) => setBolShipperCity(e.target.value)} placeholder="Shipper city" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolConsigneeName} onChange={(e) => setBolConsigneeName(e.target.value)} placeholder="Consignee name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolConsigneeCity} onChange={(e) => setBolConsigneeCity(e.target.value)} placeholder="Consignee city" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolProNumber} onChange={(e) => setBolProNumber(e.target.value)} placeholder="PRO # (optional)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <select value={bolTerms} onChange={(e) => setBolTerms(e.target.value as typeof bolTerms)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                <option value="prepaid">Freight prepaid</option>
                <option value="collect">Freight collect</option>
                <option value="third_party">Third-party billing</option>
              </select>
              <input value={bolLineDescription} onChange={(e) => setBolLineDescription(e.target.value)} placeholder="Freight description" className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolLinePieces} onChange={(e) => setBolLinePieces(e.target.value)} placeholder="Pieces" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolLineWeightLb} onChange={(e) => setBolLineWeightLb(e.target.value)} placeholder="Weight (lb)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={bolLineClass} onChange={(e) => setBolLineClass(e.target.value)} placeholder="NMFC class" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <label className="col-span-2 flex items-center gap-1 text-[11px] text-slate-700">
                <input type="checkbox" checked={bolIsHazmat} onChange={(e) => setBolIsHazmat(e.target.checked)} />
                Contains hazardous materials
              </label>
            </div>
          )}

          {kind === "commercial_invoice" && (
            <div className="grid grid-cols-2 gap-3">
              <input value={ciNumber} onChange={(e) => setCiNumber(e.target.value)} placeholder="Invoice number" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciCurrency} onChange={(e) => setCiCurrency(e.target.value)} placeholder="Currency (USD/CAD)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
              <input value={ciSoldByName} onChange={(e) => setCiSoldByName(e.target.value)} placeholder="Sold by (exporter)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciSoldToName} onChange={(e) => setCiSoldToName(e.target.value)} placeholder="Sold to (importer)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciShipToName} onChange={(e) => setCiShipToName(e.target.value)} placeholder="Ship to" className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciIncoterm} onChange={(e) => setCiIncoterm(e.target.value)} placeholder="Incoterm" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
              <input value={ciIncotermPlace} onChange={(e) => setCiIncotermPlace(e.target.value)} placeholder="Incoterm place" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciLineDesc} onChange={(e) => setCiLineDesc(e.target.value)} placeholder="Line description" className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciLineHs} onChange={(e) => setCiLineHs(e.target.value)} placeholder="HS code" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciLineOrigin} onChange={(e) => setCiLineOrigin(e.target.value)} placeholder="Country of origin" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
              <input value={ciLinePieces} onChange={(e) => setCiLinePieces(e.target.value)} placeholder="Pieces / units" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ciLineUnitValue} onChange={(e) => setCiLineUnitValue(e.target.value)} placeholder="Unit value (USD)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            </div>
          )}

          {kind === "usmca_cert" && (
            <div className="grid grid-cols-2 gap-3">
              <select value={ucCertifierType} onChange={(e) => setUcCertifierType(e.target.value as typeof ucCertifierType)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                <option value="exporter">Certifier: Exporter</option>
                <option value="producer">Certifier: Producer</option>
                <option value="importer">Certifier: Importer</option>
              </select>
              <input value={ucCertifierName} onChange={(e) => setUcCertifierName(e.target.value)} placeholder="Certifier company name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ucGoodDesc} onChange={(e) => setUcGoodDesc(e.target.value)} placeholder="Goods description" className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ucGoodHs} onChange={(e) => setUcGoodHs(e.target.value)} placeholder="HS code" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ucGoodOrigin} onChange={(e) => setUcGoodOrigin(e.target.value)} placeholder="Country of origin" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
              <select value={ucGoodCriterion} onChange={(e) => setUcGoodCriterion(e.target.value as typeof ucGoodCriterion)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                <option value="A">A — Wholly obtained/produced in territory</option>
                <option value="B">B — Produced entirely, HS-classification change</option>
                <option value="C">C — Produced entirely from originating materials</option>
                <option value="D">D — Article 4.2(d) (limited disassembly)</option>
              </select>
              <input value={ucSignatoryName} onChange={(e) => setUcSignatoryName(e.target.value)} placeholder="Signatory name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              <input value={ucSignatoryTitle} onChange={(e) => setUcSignatoryTitle(e.target.value)} placeholder="Signatory title" className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button onClick={generate} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Generate & download PDF
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
