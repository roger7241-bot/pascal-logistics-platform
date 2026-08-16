import { useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  Package,
  Truck,
  Clock,
  AlertTriangle,
  QrCode,
  MessageSquareText,
  Printer,
  Ban,
  Trash2,
  ScanLine,
  X,
  ChevronRight,
  Calculator,
  Plus,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";
import { calculateFreightClass, lbsToKg, kgToLbs } from "../lib/freightClass";
import type {
  CarrierCutoffInfo,
  CarrierServiceType,
  ConsigneeOption,
  MagicUploadTokenResult,
  OutboundStagingRecord,
  PackagingType,
  WeightUnit,
} from "../types/dispatch";
import { PACKAGING_DEFAULT_LBS_PER_UNIT, PACKAGING_LABEL } from "../types/dispatch";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
const ORG_ID = "org_meridian";

type ScanTarget = "po" | "bol" | "sku" | "pallet" | "papsPars";

const SCAN_TARGET_LABEL: Record<ScanTarget, string> = {
  po: "PO#",
  bol: "BOL#",
  sku: "SKU",
  pallet: "Pallet Barcode",
  papsPars: "PAPS/PARS",
};

const URGENCY_CLASS: Record<CarrierCutoffInfo["urgency"], string> = {
  urgent: "border-rose-300 bg-rose-50 text-rose-700",
  soon: "border-amber-300 bg-amber-50 text-amber-700",
  normal: "border-emerald-300 bg-emerald-50 text-emerald-700",
  past_cutoff: "border-slate-300 bg-slate-100 text-slate-500",
  unknown: "border-slate-200 bg-white text-slate-400",
};

function formatCutoff(c: CarrierCutoffInfo): string {
  if (c.urgency === "unknown") return "No cutoff on file";
  if (c.urgency === "past_cutoff") return "Cutoff passed";
  const mins = c.minutesToCutoff ?? 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `${timeStr} to cutoff${c.urgency === "urgent" ? " — Urgent" : ""}`;
}

/** Global barcode/HID scanner hook. Scanners type characters far faster
 * than any human (typically <20ms between keystrokes) and terminate with
 * Enter. This listens on the whole document — not a specific input — so a
 * clerk can scan without clicking into a field first, then routes the
 * captured code to whichever field is currently selected as the scan
 * target. Ignores keystrokes while a text input already has focus, so it
 * doesn't fight normal typing. */
function useGlobalScannerHook(onScan: (code: string) => void) {
  const buffer = useRef("");
  const lastKeyTime = useRef(0);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const active = document.activeElement;
      const typingInField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (typingInField) return;

      const now = performance.now();
      const gap = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (e.key === "Enter") {
        if (buffer.current.length >= 3) onScan(buffer.current);
        buffer.current = "";
        return;
      }
      if (e.key.length !== 1) return; // ignore modifier/arrow/etc keys

      // Gap > 60ms between characters means a human is typing, not a
      // scanner firing a stored HID sequence — reset instead of appending.
      if (gap > 60) buffer.current = "";
      buffer.current += e.key;
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onScan]);
}

export function RapidDispatchDesk() {
  const [consignees, setConsignees] = useState<ConsigneeOption[]>([]);
  const [carriers, setCarriers] = useState<CarrierCutoffInfo[]>([]);
  const [staging, setStaging] = useState<OutboundStagingRecord[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);

  // --- intake form state ---
  const [scanTarget, setScanTarget] = useState<ScanTarget>("po");
  const [poNumber, setPoNumber] = useState("");
  const [bolNumber, setBolNumber] = useState("");
  const [sku, setSku] = useState("");
  const [selectedConsigneeId, setSelectedConsigneeId] = useState("");
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [packagingType, setPackagingType] = useState<PackagingType>("standard_48x40");
  const [palletCount, setPalletCount] = useState(1);
  const [grossWeightLbs, setGrossWeightLbs] = useState(PACKAGING_DEFAULT_LBS_PER_UNIT.standard_48x40);
  const [weightManuallyOverridden, setWeightManuallyOverridden] = useState(false);
  const [freightClass, setFreightClass] = useState("");
  const [showDensityCalc, setShowDensityCalc] = useState(false);
  const [dimLength, setDimLength] = useState("");
  const [dimWidth, setDimWidth] = useState("");
  const [dimHeight, setDimHeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("lbs");
  const [showAddCarrier, setShowAddCarrier] = useState(false);
  const [newCarrierName, setNewCarrierName] = useState("");
  const [newCarrierScac, setNewCarrierScac] = useState("");
  const [newCarrierPhone, setNewCarrierPhone] = useState("");
  const [newCarrierService, setNewCarrierService] = useState<CarrierServiceType>("LTL");
  const [savingCarrier, setSavingCarrier] = useState(false);
  const [isCrossBorder, setIsCrossBorder] = useState(false);
  const [papsParsBarcode, setPapsParsBarcode] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverName, setDriverName] = useState("");
  const [trailerSealNumber, setTrailerSealNumber] = useState("");
  const [dockDoor, setDockDoor] = useState("");
  const [handlingNotes, setHandlingNotes] = useState("");
  const [weightBaseline, setWeightBaseline] = useState<{ avgGrossWeightLbs: number; sampleSize: number } | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [flashField, setFlashField] = useState<ScanTarget | undefined>();

  const [magicLinkFor, setMagicLinkFor] = useState<string | undefined>();
  const [magicLink, setMagicLink] = useState<MagicUploadTokenResult | undefined>();
  const [smsStatus, setSmsStatus] = useState<Record<string, "sending" | "sent" | "error">>({});
  const [printing, setPrinting] = useState<string | undefined>();

  const formRef = useRef<HTMLDivElement>(null);

  const selectedConsignee = consignees.find((c) => c.id === selectedConsigneeId);

  // --- data loads ---
  function loadQueue() {
    setLoadingQueue(true);
    api
      .dispatchStagingQueue<{ staging: OutboundStagingRecord[] }>(ORG_ID)
      .then((d) => setStaging(d.staging))
      .finally(() => setLoadingQueue(false));
  }

  useEffect(() => {
    api.dispatchConsignees<{ consignees: ConsigneeOption[] }>(ORG_ID).then((d) => setConsignees(d.consignees));
    api.dispatchCarriers<{ carriers: CarrierCutoffInfo[] }>(ORG_ID).then((d) => setCarriers(d.carriers));
    loadQueue();
    const interval = setInterval(() => {
      api.dispatchCarriers<{ carriers: CarrierCutoffInfo[] }>(ORG_ID).then((d) => setCarriers(d.carriers));
    }, 60_000); // countdown tickers refresh every 60s — no need for anything faster
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.dispatchWeightBaseline<{ avgGrossWeightLbs: number; sampleSize: number }>(packagingType).then(setWeightBaseline);
  }, [packagingType]);

  // --- predictive consignee autofill ---
  function handleSelectConsignee(id: string) {
    setSelectedConsigneeId(id);
    const consignee = consignees.find((c) => c.id === id);
    if (consignee) setIsCrossBorder(consignee.isCrossBorderCandidate);
  }

  // --- packaging presets ---
  function applyPreset(type: PackagingType) {
    setPackagingType(type);
    if (!weightManuallyOverridden) {
      setGrossWeightLbs(Math.round(palletCount * PACKAGING_DEFAULT_LBS_PER_UNIT[type]));
    }
  }

  function handlePalletCountChange(count: number) {
    setPalletCount(count);
    if (!weightManuallyOverridden) {
      setGrossWeightLbs(Math.round(count * PACKAGING_DEFAULT_LBS_PER_UNIT[packagingType]));
    }
  }

  // --- freight class density calculator ---
  const densityResult = useMemo(() => {
    const l = Number(dimLength), w = Number(dimWidth), h = Number(dimHeight);
    return calculateFreightClass(l, w, h, palletCount, grossWeightLbs);
  }, [dimLength, dimWidth, dimHeight, palletCount, grossWeightLbs]);

  function applyCalculatedClass() {
    if (densityResult) setFreightClass(densityResult.freightClass);
    setShowDensityCalc(false);
  }

  // --- lbs/kg dual weight ---
  function handleWeightChange(value: number, unit: WeightUnit) {
    setWeightManuallyOverridden(true);
    setGrossWeightLbs(unit === "lbs" ? value : kgToLbs(value));
  }
  const grossWeightKg = lbsToKg(grossWeightLbs);

  // --- quick add carrier ---
  async function handleAddCarrier() {
    if (!newCarrierName.trim()) return;
    setSavingCarrier(true);
    try {
      const carrier = await api.createCarrier<{ id: string; carrierName: string }>({
        orgId: ORG_ID,
        carrierName: newCarrierName,
        accountNumber: "PENDING", // placeholder — real account number set later in Carrier Desk
        scacCode: newCarrierScac || undefined,
        emergencyPhone: newCarrierPhone || undefined,
        carrierMode: "road",
        serviceType: newCarrierService,
      });
      setCarriers((prev) => [...prev, { id: carrier.id, carrierName: carrier.carrierName, cutoffTimezone: "America/Los_Angeles", urgency: "unknown" }]);
      setSelectedCarrierId(carrier.id);
      setShowAddCarrier(false);
      setNewCarrierName("");
      setNewCarrierScac("");
      setNewCarrierPhone("");
    } finally {
      setSavingCarrier(false);
    }
  }

  // --- weight anomaly sentinel ---
  const weightAnomaly = useMemo(() => {
    if (!weightBaseline || weightBaseline.sampleSize === 0 || grossWeightLbs <= 0) return undefined;
    const deviationPct = ((grossWeightLbs - weightBaseline.avgGrossWeightLbs) / weightBaseline.avgGrossWeightLbs) * 100;
    if (Math.abs(deviationPct) > 20) return { deviationPct: Math.round(deviationPct) };
    return undefined;
  }, [grossWeightLbs, weightBaseline]);

  // --- global scanner routing ---
  useGlobalScannerHook((code) => {
    setFlashField(scanTarget);
    setTimeout(() => setFlashField(undefined), 600);
    if (scanTarget === "po") setPoNumber(code);
    else if (scanTarget === "bol") setBolNumber(code);
    else if (scanTarget === "sku") setSku(code);
    else if (scanTarget === "pallet") setPalletCount((prev) => prev + 1); // pallet barcode scan increments count
    else if (scanTarget === "papsPars") setPapsParsBarcode(code);
  });

  // --- dispatch (submit) ---
  async function handleStage() {
    setSubmitting(true);
    try {
      await api.createDispatchStaging({
        orgId: ORG_ID,
        poNumber: poNumber || undefined,
        bolNumber: bolNumber || undefined,
        sku: sku || undefined,
        consigneeFacilityId: selectedConsigneeId || undefined,
        carrierAccountId: selectedCarrierId || undefined,
        packagingType,
        palletCount,
        grossWeightLbs,
        freightClass: freightClass || undefined,
        isCrossBorder,
        papsParsBarcode: papsParsBarcode || undefined,
        driverPhone: driverPhone || undefined,
        driverName: driverName || undefined,
        trailerSealNumber: trailerSealNumber || undefined,
        dockDoor: dockDoor || undefined,
        handlingNotes: handlingNotes || undefined,
        stagedBy: "Warehouse Clerk",
      });
      // reset for next entry — keyboard-first flow means clerks stage
      // dozens of these in a row without touching the mouse
      setPoNumber("");
      setBolNumber("");
      setSku("");
      setPapsParsBarcode("");
      setWeightManuallyOverridden(false);
      loadQueue();
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleStage();
    }
  }

  // --- queue actions ---
  async function handlePrintLabel(record: OutboundStagingRecord) {
    setPrinting(record.id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/operator/dispatch/staging/${record.id}/dispatch`, { method: "PATCH" });
      if (!response.ok) throw new Error(`Label generation failed (${response.status})`);
      const blob = await response.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
      loadQueue();
    } finally {
      setPrinting(undefined);
    }
  }

  async function handleSendGateSms(record: OutboundStagingRecord) {
    if (!record.driverPhone) return;
    setSmsStatus((prev) => ({ ...prev, [record.id]: "sending" }));
    try {
      await api.sendDispatchGateSms(record.id, { driverPhone: record.driverPhone });
      setSmsStatus((prev) => ({ ...prev, [record.id]: "sent" }));
    } catch {
      setSmsStatus((prev) => ({ ...prev, [record.id]: "error" }));
    }
  }

  async function handleCancel(record: OutboundStagingRecord) {
    if (!confirm(`Void staging for ${record.bolNumber ?? record.id}?`)) return;
    await api.cancelDispatchStaging(record.id);
    loadQueue();
  }

  async function handleDelete(record: OutboundStagingRecord) {
    if (!confirm(`Permanently delete staging for ${record.bolNumber ?? record.id}? This cannot be undone.`)) return;
    await api.deleteDispatchStaging(record.id);
    setStaging((prev) => prev.filter((s) => s.id !== record.id));
  }

  async function handleOpenMagicLink(record: OutboundStagingRecord) {
    setMagicLinkFor(record.id);
    const link = await api.createMagicUploadLink<MagicUploadTokenResult>(record.id);
    setMagicLink(link);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" onKeyDown={handleFormKeyDown} ref={formRef}>
      <OperatorHeader />
      <main className="mx-auto max-w-[1500px] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Rapid Situational Outbound Dispatch Desk</h1>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <ScanLine size={13} /> Scanner-ready · Tab/Enter to move · Ctrl/Cmd+Enter to stage
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          {/* ============ INTAKE FORM ============ */}
          <div className="space-y-4">
            {/* Scan target selector */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-slate-400">Scanner routes to:</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SCAN_TARGET_LABEL) as ScanTarget[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setScanTarget(t)}
                    className={`rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                      scanTarget === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {SCAN_TARGET_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Identifiers */}
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <ScanField label="PO#" value={poNumber} onChange={setPoNumber} flashing={flashField === "po"} />
              <ScanField label="BOL#" value={bolNumber} onChange={setBolNumber} flashing={flashField === "bol"} />
              <ScanField label="SKU" value={sku} onChange={setSku} flashing={flashField === "sku"} />
            </div>

            {/* Consignee autofill */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="mb-1 block text-xs font-medium text-slate-500">Consignee (predictive — most-staged first)</label>
              <select
                value={selectedConsigneeId}
                onChange={(e) => handleSelectConsignee(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"
              >
                <option value="">— Select consignee —</option>
                {consignees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.city}, {c.stateOrProvince} {c.stagingCount > 0 ? `(${c.stagingCount}x)` : ""}
                  </option>
                ))}
              </select>
              {selectedConsignee && (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-4">
                  <div>
                    <p className="text-slate-400">Receiving hours</p>
                    <p className="font-semibold text-slate-800">{selectedConsignee.receivingHoursStart}–{selectedConsignee.receivingHoursEnd}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Free time</p>
                    <p className="font-semibold text-slate-800">{selectedConsignee.freeTimeMinutes} min</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Preferred carrier</p>
                    <p className="italic text-slate-400">Not on file</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Customs broker</p>
                    <p className="italic text-slate-400">{selectedConsignee.isCrossBorderCandidate ? "Not on file" : "N/A — domestic"}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Packaging presets + weight */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Packaging preset</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {(Object.keys(PACKAGING_LABEL) as PackagingType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => applyPreset(t)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                      packagingType === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <Package size={12} /> {PACKAGING_LABEL[t]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Pallet Count</span>
                  <ScanField label="" value={String(palletCount)} onChange={(v) => handlePalletCountChange(Number(v) || 0)} flashing={flashField === "pallet"} type="number" />
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
                    Gross Weight
                    <span className="flex rounded-md border border-slate-200 text-[10px] font-semibold">
                      <button type="button" onClick={() => setWeightUnit("lbs")} className={`px-1.5 py-0.5 ${weightUnit === "lbs" ? "bg-slate-900 text-white" : "text-slate-500"}`}>lbs</button>
                      <button type="button" onClick={() => setWeightUnit("kg")} className={`px-1.5 py-0.5 ${weightUnit === "kg" ? "bg-slate-900 text-white" : "text-slate-500"}`}>kg</button>
                    </span>
                  </span>
                  <input
                    type="number"
                    value={weightUnit === "lbs" ? grossWeightLbs : grossWeightKg}
                    onChange={(e) => handleWeightChange(Number(e.target.value) || 0, weightUnit)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                  />
                  <span className="mt-0.5 block text-[10px] text-slate-400">{weightUnit === "lbs" ? `${grossWeightKg.toLocaleString()} kg` : `${grossWeightLbs.toLocaleString()} lbs`}</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Freight Class</span>
                  <div className="relative flex gap-1">
                    <input value={freightClass} onChange={(e) => setFreightClass(e.target.value)} placeholder="e.g. 85" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                    <button type="button" onClick={() => setShowDensityCalc((v) => !v)} title="Density calculator" className="rounded-lg border border-slate-200 px-2 text-slate-500 hover:bg-slate-50">
                      <Calculator size={14} />
                    </button>
                    {showDensityCalc && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                        <p className="mb-2 text-xs font-semibold text-slate-600">Density Calculator (NMFC)</p>
                        <div className="mb-2 grid grid-cols-3 gap-1">
                          <input value={dimLength} onChange={(e) => setDimLength(e.target.value)} placeholder="L (in)" className="rounded border border-slate-200 px-2 py-1 text-xs" />
                          <input value={dimWidth} onChange={(e) => setDimWidth(e.target.value)} placeholder="W (in)" className="rounded border border-slate-200 px-2 py-1 text-xs" />
                          <input value={dimHeight} onChange={(e) => setDimHeight(e.target.value)} placeholder="H (in)" className="rounded border border-slate-200 px-2 py-1 text-xs" />
                        </div>
                        {densityResult && (
                          <p className="mb-2 text-xs text-slate-500">
                            {densityResult.densityPcf} PCF → <strong className="text-slate-800">Class {densityResult.freightClass}</strong>
                          </p>
                        )}
                        <button onClick={applyCalculatedClass} disabled={!densityResult} className="w-full rounded-md bg-slate-900 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                          Apply Calculated Class
                        </button>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              {weightAnomaly && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  <AlertTriangle size={13} />
                  Gross weight is {Math.abs(weightAnomaly.deviationPct)}% {weightAnomaly.deviationPct > 0 ? "above" : "below"} the historical average for{" "}
                  {PACKAGING_LABEL[packagingType]} ({weightBaseline?.avgGrossWeightLbs.toLocaleString()} lbs avg, {weightBaseline?.sampleSize} prior loads). Double-check before staging.
                </div>
              )}
            </div>

            {/* Cross-border smart gate */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <input type="checkbox" checked={isCrossBorder} onChange={(e) => setIsCrossBorder(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                Cross-border shipment (US/CA)
              </label>
              {isCrossBorder && (
                <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-cyan-800">PAPS/PARS entry required — Commercial Invoice template auto-bound on dispatch.</p>
                  <ScanField label="PAPS/PARS Barcode" value={papsParsBarcode} onChange={setPapsParsBarcode} flashing={flashField === "papsPars"} />
                </div>
              )}
            </div>

            {/* Driver phone + carrier + stage button */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
                    Carrier
                    <button type="button" onClick={() => setShowAddCarrier(true)} className="flex items-center gap-0.5 text-cyan-700 hover:underline">
                      <Plus size={11} /> Add New Carrier
                    </button>
                  </span>
                  <select value={selectedCarrierId} onChange={(e) => setSelectedCarrierId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400">
                    <option value="">— Select carrier —</option>
                    {carriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.carrierName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Driver Name</span>
                  <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Driver Phone (for gate SMS)</span>
                  <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+16045551234" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Trailer / Seal #</span>
                  <input value={trailerSealNumber} onChange={(e) => setTrailerSealNumber(e.target.value)} placeholder="e.g. TRLR4471 / SEAL00219" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Dock Door</span>
                  <input value={dockDoor} onChange={(e) => setDockDoor(e.target.value)} placeholder="e.g. Door 7" className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
                </label>
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Handling Notes (optional)</span>
                <textarea
                  value={handlingNotes}
                  onChange={(e) => setHandlingNotes(e.target.value)}
                  placeholder="Anything unusual at dispatch — damage, delay, special instructions..."
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                />
              </label>

              <button
                onClick={handleStage}
                disabled={submitting}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-4 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <ChevronRight size={18} /> {submitting ? "Staging…" : "Stage Shipment (Ctrl/Cmd + Enter)"}
              </button>
            </div>
          </div>

          {/* ============ CARRIER CUTOFF SIDEBAR ============ */}
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Clock size={13} /> Carrier Cut-Off Countdown
              </p>
              <div className="space-y-2">
                {carriers.map((c) => (
                  <div key={c.id} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${URGENCY_CLASS[c.urgency]}`}>
                    <p>{c.carrierName}</p>
                    <p className="font-normal">{formatCutoff(c)}</p>
                  </div>
                ))}
                {carriers.length === 0 && <p className="text-xs text-slate-400">No carrier accounts on file.</p>}
              </div>
            </div>
          </div>
        </div>

        {/* ============ TODAY'S OUTBOUND QUEUE ============ */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Truck size={15} /> Today's Outbound Queue {loadingQueue && <span className="text-slate-400">(loading…)</span>}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {staging.map((s) => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-32 shrink-0">
                  <p className="font-mono text-xs font-bold text-slate-900">{s.bolNumber ?? s.poNumber ?? s.id.slice(0, 8)}</p>
                  <p className="text-xs text-slate-400">
                    {PACKAGING_LABEL[s.packagingType]}
                    {s.driverName ? ` · ${s.driverName}` : ""}
                    {s.trailerSealNumber ? ` · ${s.trailerSealNumber}` : ""}
                    {s.dockDoor ? ` · ${s.dockDoor}` : ""}
                  </p>
                  {s.handlingNotes && <p className="mt-0.5 text-xs italic text-amber-600">⚠ {s.handlingNotes}</p>}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900">{s.consigneeName ?? "—"}</p>
                  <p className="text-xs text-slate-500">
                    {s.carrierName ?? "No carrier"} · {s.palletCount} plt · {s.grossWeightLbs.toLocaleString()} lbs {s.isCrossBorder && "· Cross-border"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    s.status === "dispatched" ? "bg-emerald-100 text-emerald-700" : s.status === "cancelled" ? "bg-rose-100 text-rose-700" : s.status === "loaded" ? "bg-cyan-100 text-cyan-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {s.status}
                </span>

                {s.status !== "cancelled" && s.status !== "dispatched" && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => handleOpenMagicLink(s)} title="Magic upload — mobile BOL photo" className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50">
                      <QrCode size={13} />
                    </button>
                    <button
                      onClick={() => handleSendGateSms(s)}
                      disabled={!s.driverPhone || smsStatus[s.id] === "sending"}
                      title="Send driver gate SMS"
                      className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <MessageSquareText size={13} />
                    </button>
                    <button onClick={() => handlePrintLabel(s)} disabled={printing === s.id} className="flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                      <Printer size={12} /> {printing === s.id ? "Printing…" : "Dispatch & Print"}
                    </button>
                    <button onClick={() => handleDelete(s)} title="Delete permanently" className="rounded-md border border-rose-300 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                      <Trash2 size={13} />
                    </button>
                    <button onClick={() => handleCancel(s)} title="Void staging" className="rounded-md border border-rose-200 p-1.5 text-rose-500 hover:bg-rose-50">
                      <Ban size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!loadingQueue && staging.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No shipments staged yet today.</p>}
          </div>
        </div>
      </main>

      {/* Magic upload QR modal */}
      {magicLinkFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMagicLinkFor(undefined)}>
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <QrCode size={15} /> Scan to Upload BOL Photo
              </p>
              <button onClick={() => setMagicLinkFor(undefined)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X size={15} />
              </button>
            </div>
            {magicLink ? (
              <>
                <img src={magicLink.qrCodeDataUri} alt="Magic upload QR code" className="mx-auto mb-3 h-56 w-56" />
                <p className="text-xs text-slate-500">No login required — scan with any phone camera. Link expires {new Date(magicLink.expiresAtIso).toLocaleTimeString()}.</p>
              </>
            ) : (
              <p className="py-10 text-xs text-slate-400">Generating…</p>
            )}
          </div>
        </div>
      )}
      {/* Add New Carrier modal */}
      {showAddCarrier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddCarrier(false)}>
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Add New Carrier</p>
              <button onClick={() => setShowAddCarrier(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X size={15} />
              </button>
            </div>
            <div className="space-y-2.5">
              <input value={newCarrierName} onChange={(e) => setNewCarrierName(e.target.value)} placeholder="Carrier Name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={newCarrierScac} onChange={(e) => setNewCarrierScac(e.target.value)} placeholder="SCAC Code" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={newCarrierPhone} onChange={(e) => setNewCarrierPhone(e.target.value)} placeholder="Contact / Dispatch Phone" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <select value={newCarrierService} onChange={(e) => setNewCarrierService(e.target.value as CarrierServiceType)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="LTL">LTL</option>
                <option value="FTL">FTL</option>
                <option value="Reefer">Reefer</option>
              </select>
            </div>
            <button onClick={handleAddCarrier} disabled={savingCarrier || !newCarrierName.trim()} className="mt-4 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {savingCarrier ? "Saving…" : "Save & Select Carrier"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanField({ label, value, onChange, flashing, type = "text" }: { label: string; value: string; onChange: (v: string) => void; flashing?: boolean; type?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-4 py-3.5 text-base outline-none transition-colors focus:border-slate-400 ${flashing ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}
      />
    </label>
  );
}
