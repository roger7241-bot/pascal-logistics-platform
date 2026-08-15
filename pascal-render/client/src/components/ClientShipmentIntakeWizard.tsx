import { useEffect, useState } from "react";
import {
  X,
  Truck,
  TrainFront,
  Ship,
  Plane,
  ChevronLeft,
  ChevronRight,
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Loader2,
  TrendingDown,
} from "lucide-react";
import { api } from "../config/api";

interface SavedFacility {
  id: string;
  name: string;
  role: "shipper" | "consignee" | "both";
  street: string;
  city: string;
  stateOrProvince: string;
  countryCode: string;
  postalCode: string;
  contactPhoneE164?: string;
}

type TransportMode = "road" | "rail" | "ocean" | "air";
type WizardStep = 1 | 2 | 3 | 4;

interface HandlingUnitForm {
  quantity: string;
  packagingType: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
}

const BORDER_CROSSINGS = ["Pacific Highway", "Sumas", "Aldergrove", "Peace Arch", "Point Roberts"];

export interface ClientShipmentIntakeWizardProps {
  onClose: () => void;
}

export function ClientShipmentIntakeWizard({ onClose }: ClientShipmentIntakeWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1 — mode & routing
  const [mode, setMode] = useState<TransportMode>("road");
  const [borderCrossing, setBorderCrossing] = useState("Pacific Highway");
  const [railRampOrigin, setRailRampOrigin] = useState("CN Surrey");
  const [railRampDestination, setRailRampDestination] = useState("");
  const [containerNumber, setContainerNumber] = useState("");
  const [chassisNumber, setChassisNumber] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [originIata, setOriginIata] = useState("");
  const [destIata, setDestIata] = useState("");
  const [shipperName, setShipperName] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [savedFacilities, setSavedFacilities] = useState<SavedFacility[]>([]);
  const [selectedShipperId, setSelectedShipperId] = useState("");
  const [selectedConsigneeId, setSelectedConsigneeId] = useState("");

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL}/api/client/facilities`)
      .then((r) => r.json())
      .then((data) => setSavedFacilities(data.facilities ?? []))
      .catch(() => setSavedFacilities([])); // Baseline not set up yet — falls back to free text below, not a hard failure.
  }, []);

  const shipperFacility = savedFacilities.find((f) => f.id === selectedShipperId);
  const consigneeFacility = savedFacilities.find((f) => f.id === selectedConsigneeId);

  // Step 2 — cargo & compliance
  const [poNumber, setPoNumber] = useState("");
  const [handlingUnits, setHandlingUnits] = useState<HandlingUnitForm[]>([{ quantity: "", packagingType: "pallet", lengthIn: "", widthIn: "", heightIn: "" }]);
  const [totalWeightLbs, setTotalWeightLbs] = useState("");
  const [weightUnit, setWeightUnit] = useState<"lbs" | "kg">("lbs");
  const [totalCartons, setTotalCartons] = useState("");
  const [freightClass, setFreightClass] = useState("");
  const [equipmentType, setEquipmentType] = useState<"dry_van_53" | "dry_van_48" | "reefer_53" | "flatbed_48" | "stepdeck" | "ltl_pallet">("dry_van_53");
  const [tailgateRequired, setTailgateRequired] = useState(false);
  const [reeferEnabled, setReeferEnabled] = useState(false);
  const [reeferTempF, setReeferTempF] = useState("");
  const [reeferTempUnit, setReeferTempUnit] = useState<"F" | "C">("F");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CAD" | "EUR">("USD");
  const [htsCode, setHtsCode] = useState("");
  const [countryOfOrigin, setCountryOfOrigin] = useState("CA");
  const [isHazmat, setIsHazmat] = useState(false);
  const [unNumber, setUnNumber] = useState("");
  const [hazardClass, setHazardClass] = useState("");
  const [packingGroup, setPackingGroup] = useState<"I" | "II" | "III">("II");
  const [customsBrokerName, setCustomsBrokerName] = useState("");
  const [papsParsBarcode, setPapsParsBarcode] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupStart, setPickupStart] = useState("");
  const [pickupEnd, setPickupEnd] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [strictAppointment, setStrictAppointment] = useState(false);

  // Step 3 — document parsing
  const [parsing, setParsing] = useState(false);
  const [parsedFilename, setParsedFilename] = useState<string | undefined>(undefined);

  // Step 4 — billing & submit
  const [billingOption, setBillingOption] = useState<"carrier_account" | "house_spot">("carrier_account");
  const [carrierAccountName, setCarrierAccountName] = useState("ODFL");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ approvalStatus: string; shipmentId: string; confidenceScore: number; rateOptimization?: { contractedRateUsd: number; benchmarkSpotRateUsd: number; savingsPct: number } } | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  const addHandlingUnit = () => setHandlingUnits((prev) => [...prev, { quantity: "", packagingType: "pallet", lengthIn: "", widthIn: "", heightIn: "" }]);
  const removeHandlingUnit = (i: number) => setHandlingUnits((prev) => prev.filter((_, idx) => idx !== i));
  const updateHandlingUnit = (i: number, field: keyof HandlingUnitForm, value: string) =>
    setHandlingUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, [field]: value } : u)));

  const [documentText, setDocumentText] = useState("");
  const [parseError, setParseError] = useState<string | undefined>(undefined);

  const handleParseDocument = async () => {
    if (!documentText.trim()) return;
    setParsing(true);
    setParseError(undefined);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/documents/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentText }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error ?? "Extraction failed.");

      const fields = result.fields ?? {};
      if (fields.shipperName) setShipperName((v) => v || fields.shipperName);
      if (fields.consigneeName) setConsigneeName((v) => v || fields.consigneeName);
      if (fields.commercialInvoiceValue) setInvoiceValue((v) => v || String(fields.commercialInvoiceValue));
      if (fields.htsCode) setHtsCode((v) => v || fields.htsCode);
      if (fields.countryOfOrigin) setCountryOfOrigin((v) => v || fields.countryOfOrigin);
      setParsedFilename(result.simulated ? "pasted text (simulated — no ANTHROPIC_API_KEY configured)" : "pasted text (extracted via Claude)");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not parse the document text.");
    } finally {
      setParsing(false);
    }
  };

  const canAdvance =
    step === 1
      ? Boolean(
          (shipperFacility || shipperName.trim()) &&
            (consigneeFacility || consigneeName.trim()) &&
            (mode !== "road" || borderCrossing) &&
            (mode !== "rail" || (railRampOrigin && railRampDestination)) &&
            (mode !== "ocean" || (portOfLoading && portOfDischarge)) &&
            (mode !== "air" || (originIata && destIata)),
        )
      : step === 2
      ? Boolean(handlingUnits.some((u) => u.quantity) && totalWeightLbs && invoiceValue && htsCode && countryOfOrigin)
      : true;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(undefined);

    const payload = {
      transportMode: mode,
      poNumber: poNumber || undefined,
      routing: {
        borderCrossing: mode === "road" ? borderCrossing : undefined,
        railRampOrigin: mode === "rail" ? railRampOrigin : undefined,
        railRampDestination: mode === "rail" ? railRampDestination : undefined,
        containerNumber: mode === "rail" ? containerNumber : undefined,
        chassisNumber: mode === "rail" ? chassisNumber : undefined,
        portOfLoading: mode === "ocean" ? portOfLoading : undefined,
        portOfDischarge: mode === "ocean" ? portOfDischarge : undefined,
        originAirportIata: mode === "air" ? originIata : undefined,
        destAirportIata: mode === "air" ? destIata : undefined,
      },
      shipper: shipperFacility
        ? { facilityName: shipperFacility.name, phoneE164: shipperFacility.contactPhoneE164, street: shipperFacility.street, city: shipperFacility.city, countryCode: shipperFacility.countryCode, postalCode: shipperFacility.postalCode }
        : { facilityName: shipperName },
      consignee: consigneeFacility
        ? { facilityName: consigneeFacility.name, phoneE164: consigneeFacility.contactPhoneE164, street: consigneeFacility.street, city: consigneeFacility.city, countryCode: consigneeFacility.countryCode, postalCode: consigneeFacility.postalCode }
        : { facilityName: consigneeName },
      cargo: {
        handlingUnits: handlingUnits
          .filter((u) => u.quantity)
          .map((u) => ({ quantity: Number(u.quantity), packagingType: u.packagingType })),
        totalWeightLbs: weightUnit === "lbs" ? Number(totalWeightLbs) : Math.round(Number(totalWeightLbs) * 2.20462 * 100) / 100,
        totalWeightKg: weightUnit === "kg" ? Number(totalWeightLbs) : Math.round((Number(totalWeightLbs) / 2.20462) * 100) / 100,
        totalCartons: totalCartons ? Number(totalCartons) : undefined,
        freightClass: freightClass || undefined,
        mode: mode === "road" ? (handlingUnits.length > 1 || Number(totalWeightLbs) > 10000 ? "FTL" : "LTL") : undefined,
        equipmentType: mode === "road" ? equipmentType : undefined,
        tailgateRequired: mode === "road" ? tailgateRequired : undefined,
        isHazmat,
        hazmat: isHazmat ? { unNumber, hazardClass, packingGroup } : undefined,
        reeferTempF: reeferEnabled && reeferTempUnit === "F" ? Number(reeferTempF) : undefined,
        reeferTempC: reeferEnabled && reeferTempUnit === "C" ? Number(reeferTempF) : undefined,
      },
      customs: {
        portOfEntry: mode === "road" ? borderCrossing : undefined,
        commercialInvoiceValue: Number(invoiceValue),
        currency,
        htsCode,
        countryOfOrigin,
        pgaFlags: [],
        papsParsBarcode: mode === "road" ? papsParsBarcode || undefined : undefined,
        customsBrokerName: customsBrokerName || undefined,
      },
      billing: {
        billingTerms: billingOption === "carrier_account" ? "Prepaid" : "Third-Party",
        carrierName: billingOption === "carrier_account" ? carrierAccountName : undefined,
      },
      pickupWindow: pickupDate ? { dateIso: pickupDate, startTime: pickupStart || undefined, endTime: pickupEnd || undefined } : undefined,
      deliveryWindow: deliveryDate ? { dateIso: deliveryDate, strictAppointment } : undefined,
      source: "client_portal" as const,
    };

    try {
      const response = await api.ingestShipment<typeof result>(payload);
      setResult(response);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit shipment — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const isAuto = result.approvalStatus === "AUTO_DISPATCHED";
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-xl">
          <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${isAuto ? "bg-emerald-100 text-emerald-600" : "bg-cyan-100 text-cyan-600"}`}>
            {isAuto ? <CheckCircle2 size={24} /> : <Clock size={24} />}
          </div>
          <h2 className="mb-1 text-lg font-bold text-slate-900">
            {isAuto ? "Shipment booked" : "Shipment submitted"}
          </h2>
          <p className="mb-1 font-mono text-sm text-slate-600">{result.shipmentId}</p>
          <p className="mb-4 text-sm text-slate-600">
            {isAuto
              ? "Your shipment is confirmed and dispatched."
              : // Confidence-gated routing surfaced without alarming the client, per spec — no mention of "flagged" or "exception."
                "We're finalizing a few details on our end — you'll get an update shortly."}
          </p>
          {result.rateOptimization && result.rateOptimization.savingsPct >= 15 && (
            <div className="mb-4 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              <TrendingDown size={13} /> {result.rateOptimization.savingsPct}% savings vs spot market
            </div>
          )}
          <button onClick={onClose} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-slate-900">Book a Shipment</p>
            <p className="text-xs text-slate-500">Step {step} of 4</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-cyan-500 transition-all" style={{ width: `${(step / 4) * 100}%` }} />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Transport mode</p>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { id: "road" as const, icon: Truck, label: "Truck Freight (FTL/LTL)" },
                  { id: "rail" as const, icon: TrainFront, label: "Intermodal Rail" },
                  { id: "ocean" as const, icon: Ship, label: "Ocean Cargo" },
                  { id: "air" as const, icon: Plane, label: "Air Cargo" },
                ]).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 ${
                      mode === m.id ? "border-cyan-500 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <m.icon size={18} />
                    <span className="text-xs font-semibold">{m.label}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Shipper facility</label>
                  {savedFacilities.filter((f) => f.role !== "consignee").length > 0 ? (
                    <select
                      value={selectedShipperId}
                      onChange={(e) => {
                        setSelectedShipperId(e.target.value);
                        const f = savedFacilities.find((f) => f.id === e.target.value);
                        if (f) setShipperName(f.name);
                      }}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select a saved facility...</option>
                      {savedFacilities.filter((f) => f.role !== "consignee").map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={shipperName} onChange={(e) => setShipperName(e.target.value)} placeholder="Meridian Cold Chain" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  )}
                  {shipperFacility && <p className="mt-1 text-xs text-slate-400">{shipperFacility.street}, {shipperFacility.city}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Consignee facility</label>
                  {savedFacilities.filter((f) => f.role !== "shipper").length > 0 ? (
                    <select
                      value={selectedConsigneeId}
                      onChange={(e) => {
                        setSelectedConsigneeId(e.target.value);
                        const f = savedFacilities.find((f) => f.id === e.target.value);
                        if (f) setConsigneeName(f.name);
                      }}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select a saved facility...</option>
                      {savedFacilities.filter((f) => f.role !== "shipper").map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} placeholder="Bellingham DC" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  )}
                  {consigneeFacility && <p className="mt-1 text-xs text-slate-400">{consigneeFacility.street}, {consigneeFacility.city}</p>}
                </div>
              </div>

              {mode === "road" && (
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Border crossing</label>
                  <select value={borderCrossing} onChange={(e) => setBorderCrossing(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                    {BORDER_CROSSINGS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="auto">Auto-Select Best Route</option>
                  </select>
                </div>
              )}
              {mode === "rail" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Rail ramp origin</label>
                    <input value={railRampOrigin} onChange={(e) => setRailRampOrigin(e.target.value)} placeholder="CPKC Vancouver / CN Surrey" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Rail ramp destination</label>
                    <input value={railRampDestination} onChange={(e) => setRailRampDestination(e.target.value)} placeholder="e.g. CN Chicago" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Container #</label>
                    <input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Chassis #</label>
                    <input value={chassisNumber} onChange={(e) => setChassisNumber(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              {mode === "ocean" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Port of loading</label>
                    <input value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} placeholder="Shanghai" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Port of discharge</label>
                    <input value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)} placeholder="Vancouver" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              {mode === "air" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Origin airport (IATA)</label>
                    <input value={originIata} onChange={(e) => setOriginIata(e.target.value.toUpperCase())} placeholder="YVR" maxLength={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Destination airport (IATA)</label>
                    <input value={destIata} onChange={(e) => setDestIata(e.target.value.toUpperCase())} placeholder="LHR" maxLength={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase" />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Handling units</p>
                  <button onClick={addHandlingUnit} className="flex items-center gap-1 text-xs font-semibold text-cyan-600 hover:text-cyan-700">
                    <Plus size={12} /> Add
                  </button>
                </div>
                {handlingUnits.map((u, i) => (
                  <div key={i} className="mb-2 grid grid-cols-6 gap-2">
                    <input value={u.quantity} onChange={(e) => updateHandlingUnit(i, "quantity", e.target.value)} placeholder="Qty" className="col-span-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                    <select value={u.packagingType} onChange={(e) => updateHandlingUnit(i, "packagingType", e.target.value)} className="col-span-2 rounded-md border border-slate-300 px-2 py-1.5 text-xs">
                      <option value="pallet">Pallet</option>
                      <option value="crate">Crate</option>
                      <option value="drum">Drum</option>
                      <option value="gaylord">Gaylord</option>
                      <option value="loose">Loose Unit</option>
                    </select>
                    <input value={u.lengthIn} onChange={(e) => updateHandlingUnit(i, "lengthIn", e.target.value)} placeholder="L" className="col-span-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                    <input value={u.widthIn} onChange={(e) => updateHandlingUnit(i, "widthIn", e.target.value)} placeholder="W" className="col-span-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                    {handlingUnits.length > 1 ? (
                      <button onClick={() => removeHandlingUnit(i)} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-rose-500">
                        <Trash2 size={13} />
                      </button>
                    ) : (
                      <input value={u.heightIn} onChange={(e) => updateHandlingUnit(i, "heightIn", e.target.value)} placeholder="H" className="col-span-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 flex items-center justify-between text-xs font-mono uppercase tracking-wide text-slate-500">
                    Total gross weight
                    <span className="flex rounded border border-slate-300 text-[10px] font-semibold normal-case">
                      <button type="button" onClick={() => setWeightUnit("lbs")} className={`px-1.5 py-0.5 ${weightUnit === "lbs" ? "bg-slate-900 text-white" : "text-slate-500"}`}>lbs</button>
                      <button type="button" onClick={() => setWeightUnit("kg")} className={`px-1.5 py-0.5 ${weightUnit === "kg" ? "bg-slate-900 text-white" : "text-slate-500"}`}>kg</button>
                    </span>
                  </label>
                  <input value={totalWeightLbs} onChange={(e) => setTotalWeightLbs(e.target.value)} placeholder="8000" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
                    <input type="checkbox" checked={reeferEnabled} onChange={(e) => setReeferEnabled(e.target.checked)} className="rounded border-slate-300" />
                    Temperature control
                  </label>
                  {reeferEnabled && (
                    <>
                      <input value={reeferTempF} onChange={(e) => setReeferTempF(e.target.value)} placeholder={`°${reeferTempUnit}`} className="w-16 rounded-md border border-slate-300 px-2 py-2 text-sm" />
                      <select value={reeferTempUnit} onChange={(e) => setReeferTempUnit(e.target.value as "F" | "C")} className="rounded-md border border-slate-300 px-1 py-2 text-xs">
                        <option>F</option>
                        <option>C</option>
                      </select>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">PO / Order #</label>
                  <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Total cartons</label>
                  <input value={totalCartons} onChange={(e) => setTotalCartons(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">NMFC freight class</label>
                  <input value={freightClass} onChange={(e) => setFreightClass(e.target.value)} placeholder="e.g. 85" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {mode === "road" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Equipment type</label>
                    <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value as typeof equipmentType)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                      <option value="dry_van_53">53' Dry Van</option>
                      <option value="reefer_53">53' Reefer</option>
                      <option value="flatbed_48">Flatbed</option>
                      <option value="stepdeck">Step Deck</option>
                    </select>
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-xs text-slate-600">
                    <input type="checkbox" checked={tailgateRequired} onChange={(e) => setTailgateRequired(e.target.checked)} className="rounded border-slate-300" />
                    Tailgate required
                  </label>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Customs compliance</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Invoice value</label>
                    <div className="flex gap-1">
                      <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} className="rounded-md border border-slate-300 px-1.5 py-2 text-xs">
                        <option>USD</option>
                        <option>CAD</option>
                        <option>EUR</option>
                      </select>
                      <input value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} placeholder="20000" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">HTS/HS code</label>
                    <input value={htsCode} onChange={(e) => setHtsCode(e.target.value)} placeholder="3808.91.5010" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Country of origin</label>
                    <input value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value.toUpperCase())} maxLength={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase" />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
                      <input type="checkbox" checked={isHazmat} onChange={(e) => setIsHazmat(e.target.checked)} className="rounded border-slate-300" />
                      Hazardous materials
                    </label>
                  </div>
                </div>
                {isHazmat && (
                  <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-200 pt-3">
                    <input value={unNumber} onChange={(e) => setUnNumber(e.target.value)} placeholder="UN Number" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <input value={hazardClass} onChange={(e) => setHazardClass(e.target.value)} placeholder="Hazard Class (1-9)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <select value={packingGroup} onChange={(e) => setPackingGroup(e.target.value as typeof packingGroup)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                      <option value="I">Packing Group I</option>
                      <option value="II">Packing Group II</option>
                      <option value="III">Packing Group III</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Customs broker &amp; scheduling</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Broker of record</label>
                    <input value={customsBrokerName} onChange={(e) => setCustomsBrokerName(e.target.value)} placeholder="e.g. Livingston International" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  {mode === "road" && (
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">PAPS/PARS barcode #</label>
                      <input value={papsParsBarcode} onChange={(e) => setPapsParsBarcode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Pickup window</label>
                    <div className="flex gap-1">
                      <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-xs" />
                      <input type="time" value={pickupStart} onChange={(e) => setPickupStart(e.target.value)} className="w-20 rounded-md border border-slate-300 px-2 py-2 text-xs" />
                      <input type="time" value={pickupEnd} onChange={(e) => setPickupEnd(e.target.value)} className="w-20 rounded-md border border-slate-300 px-2 py-2 text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Delivery window</label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-xs" />
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
                        <input type="checkbox" checked={strictAppointment} onChange={(e) => setStrictAppointment(e.target.checked)} className="rounded border-slate-300" />
                        Strict
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Document auto-parser</p>
              {parsedFilename ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <CheckCircle2 size={18} className="text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">{parsedFilename}</p>
                    <p className="text-xs text-emerald-700">Shipper, consignee, HTS code, and invoice value auto-filled where found.</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    PDF-to-text extraction isn't wired up in this build yet — paste the invoice or packing list text below and it's parsed by Claude for real.
                  </p>
                  <textarea
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    placeholder="Paste commercial invoice or packing list text here..."
                    rows={6}
                    className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
                  />
                  <button
                    onClick={handleParseDocument}
                    disabled={parsing || !documentText.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 text-slate-500 hover:border-cyan-400 hover:bg-cyan-50/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {parsing ? <Loader2 size={18} className="animate-spin text-cyan-500" /> : <Upload size={18} />}
                    <span className="text-sm font-medium">{parsing ? "Parsing document..." : "Extract fields from pasted text"}</span>
                  </button>
                  {parseError && <p className="text-xs text-rose-600">{parseError}</p>}
                </>
              )}
              <p className="text-xs text-slate-400">This step is optional — you can skip it and continue with what you've entered.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Carrier &amp; billing</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setBillingOption("carrier_account")}
                  className={`flex-1 rounded-lg border p-3 text-left text-xs ${billingOption === "carrier_account" ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}
                >
                  <p className="font-semibold text-slate-800">Use my contracted carrier account</p>
                  <p className="text-slate-500">Bill directly through your carrier relationship.</p>
                </button>
                <button
                  onClick={() => setBillingOption("house_spot")}
                  className={`flex-1 rounded-lg border p-3 text-left text-xs ${billingOption === "house_spot" ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}
                >
                  <p className="font-semibold text-slate-800">Book via Pascal house spot rate</p>
                  <p className="text-slate-500">Agent 3 benchmarks against market rates automatically.</p>
                </button>
              </div>
              {billingOption === "carrier_account" && (
                <select value={carrierAccountName} onChange={(e) => setCarrierAccountName(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option>ODFL</option>
                  <option>FedEx Freight</option>
                  <option>Maersk</option>
                </select>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-mono uppercase tracking-wide text-slate-500">Facility SOP summary</p>
                <p className="text-xs text-slate-600">Dock available, liftgate not required, receiving hours 07:00–15:00.</p>
              </div>

              {submitError && <p className="text-xs text-rose-600">{submitError}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as WizardStep))} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
            <ChevronLeft size={13} /> {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as WizardStep)}
              disabled={!canAdvance}
              className="flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <ChevronRight size={13} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
              {submitting ? "Submitting..." : "Submit & Book Shipment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
