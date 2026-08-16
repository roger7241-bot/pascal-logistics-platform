import { useEffect, useMemo, useState } from "react";
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
  Calculator,
  ShieldCheck,
} from "lucide-react";
import { api } from "../config/api";
import { calculateFreightClass, cmToIn, inToCm, kgToLbs, lbsToKg } from "../lib/freightClass";
import { AddressAutocompleteInput, type AddressSuggestion } from "./AddressAutocompleteInput";

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
  dockContactName?: string;
  dockContactPhone?: string;
  receivingEmail?: string;
  receivingHoursStart?: string;
  receivingHoursEnd?: string;
}

type TransportMode = "road" | "rail" | "ocean" | "air";
type WizardStep = 1 | 2 | 3 | 4 | 5;

interface HandlingUnitForm {
  quantity: string;
  packagingType: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
}

const BORDER_CROSSINGS = ["Pacific Highway", "Sumas", "Aldergrove", "Peace Arch", "Point Roberts"];

const MODE_LABEL: Record<string, string> = { road: "Truck Freight (FTL/LTL)", rail: "Intermodal Rail", ocean: "Ocean Cargo", air: "Air Cargo" };
const COUNTRY_LABEL: Record<string, string> = { CA: "Canada", US: "United States", MX: "Mexico", OTHER: "Other" };
const EQUIPMENT_LABEL: Record<string, string> = { dry_van_53: "53' Dry Van", dry_van_48: "48' Dry Van", reefer_53: "53' Reefer", flatbed_48: "Flatbed", stepdeck: "Step Deck", ltl_pallet: "LTL Pallet" };

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
  const [shipperManualEntry, setShipperManualEntry] = useState(false);
  const [shipperStreet, setShipperStreet] = useState("");
  const [shipperCity, setShipperCity] = useState("");
  const [shipperStateOrProvince, setShipperStateOrProvince] = useState("");
  const [shipperCountryCode, setShipperCountryCode] = useState("CA");
  const [shipperPostalCode, setShipperPostalCode] = useState("");
  const [shipperContactName, setShipperContactName] = useState("");
  const [shipperContactPhone, setShipperContactPhone] = useState("");
  const [shipperContactEmail, setShipperContactEmail] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [consigneeManualEntry, setConsigneeManualEntry] = useState(false);
  const [consigneeStreet, setConsigneeStreet] = useState("");
  const [consigneeCity, setConsigneeCity] = useState("");
  const [consigneeStateOrProvince, setConsigneeStateOrProvince] = useState("");
  const [consigneeCountryCode, setConsigneeCountryCode] = useState("US");
  const [consigneePostalCode, setConsigneePostalCode] = useState("");
  const [consigneeContactName, setConsigneeContactName] = useState("");
  const [consigneeContactPhone, setConsigneeContactPhone] = useState("");
  const [consigneeContactEmail, setConsigneeContactEmail] = useState("");
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
  const [dimensionUnit, setDimensionUnit] = useState<"in" | "cm">("in");
  const [totalCartons, setTotalCartons] = useState("");
  const [freightClass, setFreightClass] = useState("");
  const [showDensityCalc, setShowDensityCalc] = useState(false);
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
  const [dockAvailableAtPickup, setDockAvailableAtPickup] = useState<boolean | undefined>(undefined);
  const [pickupAppointmentRequired, setPickupAppointmentRequired] = useState<boolean | undefined>(undefined);
  const [documentsSentToBroker, setDocumentsSentToBroker] = useState<boolean | undefined>(undefined);
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

  const [unitsManuallySet, setUnitsManuallySet] = useState(false);

  /** Core conversion logic — shared by the explicit toggle click handlers
   * AND the automatic country-based default below, so both paths convert
   * consistently. Kept separate from the "manually set" flag so the
   * automatic default doesn't get mistaken for a deliberate user choice. */
  function applyDimensionUnit(newUnit: "in" | "cm") {
    if (newUnit === dimensionUnit) return;
    setHandlingUnits((prev) =>
      prev.map((u) => ({
        ...u,
        lengthIn: u.lengthIn ? String(newUnit === "cm" ? inToCm(Number(u.lengthIn)) : cmToIn(Number(u.lengthIn))) : u.lengthIn,
        widthIn: u.widthIn ? String(newUnit === "cm" ? inToCm(Number(u.widthIn)) : cmToIn(Number(u.widthIn))) : u.widthIn,
        heightIn: u.heightIn ? String(newUnit === "cm" ? inToCm(Number(u.heightIn)) : cmToIn(Number(u.heightIn))) : u.heightIn,
      })),
    );
    setDimensionUnit(newUnit);

    const pairedWeightUnit = newUnit === "cm" ? "kg" : "lbs";
    if (pairedWeightUnit !== weightUnit) {
      const rawWeight = Number(totalWeightLbs);
      if (rawWeight > 0) setTotalWeightLbs(String(pairedWeightUnit === "kg" ? lbsToKg(rawWeight) : kgToLbs(rawWeight)));
      setWeightUnit(pairedWeightUnit);
    }
  }

  function applyWeightUnit(newUnit: "lbs" | "kg") {
    if (newUnit === weightUnit) return;
    const rawWeight = Number(totalWeightLbs);
    if (rawWeight > 0) setTotalWeightLbs(String(newUnit === "kg" ? lbsToKg(rawWeight) : kgToLbs(rawWeight)));
    setWeightUnit(newUnit);

    const pairedDimensionUnit = newUnit === "kg" ? "cm" : "in";
    if (pairedDimensionUnit !== dimensionUnit) {
      setHandlingUnits((prev) =>
        prev.map((u) => ({
          ...u,
          lengthIn: u.lengthIn ? String(pairedDimensionUnit === "cm" ? inToCm(Number(u.lengthIn)) : cmToIn(Number(u.lengthIn))) : u.lengthIn,
          widthIn: u.widthIn ? String(pairedDimensionUnit === "cm" ? inToCm(Number(u.widthIn)) : cmToIn(Number(u.widthIn))) : u.widthIn,
          heightIn: u.heightIn ? String(pairedDimensionUnit === "cm" ? inToCm(Number(u.heightIn)) : cmToIn(Number(u.heightIn))) : u.heightIn,
        })),
      );
      setDimensionUnit(pairedDimensionUnit);
    }
  }

  /** Explicit user toggle clicks go through these — they mark units as
   * manually set, which permanently stops the automatic country-based
   * default below from overriding the shipper's deliberate choice. */
  function handleDimensionUnitChange(newUnit: "in" | "cm") {
    applyDimensionUnit(newUnit);
    setUnitsManuallySet(true);
  }

  function handleWeightUnitChange(newUnit: "lbs" | "kg") {
    applyWeightUnit(newUnit);
    setUnitsManuallySet(true);
  }

  /** Defaults to the shipper's own country's standard system — metric for
   * Canada, imperial for the US — the moment their country is known from
   * Step 1, whether from a saved facility or manual entry. Never fires
   * again once the shipper has manually touched a unit toggle themselves. */
  useEffect(() => {
    if (unitsManuallySet) return;
    const resolvedCountry = shipperManualEntry ? shipperCountryCode : shipperFacility?.countryCode;
    if (resolvedCountry === "CA") applyDimensionUnit("cm");
    else if (resolvedCountry === "US") applyDimensionUnit("in");
    // MX / other: no clear single default, leave as-is (in/lbs) until the shipper picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipperManualEntry, shipperCountryCode, shipperFacility?.countryCode, unitsManuallySet]);

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
        credentials: "include",
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
      setParsedFilename(result.simulated ? "pasted text (simulated — no ANTHROPIC_API_KEY configured)" : "pasted text (extracted via AI)");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not parse the document text.");
    } finally {
      setParsing(false);
    }
  };

  const densityResult = useMemo(() => {
    const first = handlingUnits[0];
    if (!first) return undefined;
    const rawL = Number(first.lengthIn), rawW = Number(first.widthIn), rawH = Number(first.heightIn), qty = Number(first.quantity);
    const l = dimensionUnit === "cm" ? cmToIn(rawL) : rawL;
    const w = dimensionUnit === "cm" ? cmToIn(rawW) : rawW;
    const h = dimensionUnit === "cm" ? cmToIn(rawH) : rawH;
    const rawWeight = Number(totalWeightLbs);
    const weightInLbs = weightUnit === "kg" ? kgToLbs(rawWeight) : rawWeight;
    return calculateFreightClass(l, w, h, qty, weightInLbs);
  }, [handlingUnits, totalWeightLbs, dimensionUnit, weightUnit]);

  const canAdvance =
    step === 1
      ? Boolean(
          (shipperManualEntry ? shipperName.trim() && shipperStreet.trim() && shipperCity.trim() : shipperFacility || shipperName.trim()) &&
            (consigneeManualEntry ? consigneeName.trim() && consigneeStreet.trim() && consigneeCity.trim() : consigneeFacility || consigneeName.trim()) &&
            (mode !== "road" || borderCrossing) &&
            (mode !== "rail" || (railRampOrigin && railRampDestination)) &&
            (mode !== "ocean" || (portOfLoading && portOfDischarge)) &&
            (mode !== "air" || (originIata && destIata)),
        )
      : step === 2
      ? Boolean(
          handlingUnits.some((u) => u.quantity) &&
            totalWeightLbs &&
            Number(invoiceValue) > 0 &&
            htsCode &&
            countryOfOrigin &&
            (!isHazmat || (unNumber.trim() && hazardClass.trim())) &&
            (!reeferEnabled || reeferTempF.trim()) &&
            (!pickupAppointmentRequired ||
              ((shipperContactName || shipperFacility?.dockContactName) &&
                (shipperContactPhone || shipperFacility?.dockContactPhone || shipperFacility?.contactPhoneE164) &&
                (shipperContactEmail || shipperFacility?.receivingEmail))) &&
            (!pickupDate || !deliveryDate || deliveryDate >= pickupDate),
        )
      : step === 4
      ? Boolean(
          customsBrokerName.trim() &&
            (!strictAppointment ||
              billingOption === "carrier_account" ||
              ((consigneeContactName || consigneeFacility?.dockContactName) &&
                (consigneeContactPhone || consigneeFacility?.dockContactPhone || consigneeFacility?.contactPhoneE164) &&
                (consigneeContactEmail || consigneeFacility?.receivingEmail))),
        )
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
      shipper: shipperManualEntry
        ? { facilityName: shipperName, contactPerson: shipperContactName || undefined, phoneE164: shipperContactPhone || undefined, email: shipperContactEmail || undefined, street: shipperStreet, city: shipperCity, stateOrProvince: shipperStateOrProvince || undefined, countryCode: shipperCountryCode, postalCode: shipperPostalCode || undefined }
        : shipperFacility
        ? { facilityName: shipperFacility.name, contactPerson: shipperContactName || shipperFacility.dockContactName, phoneE164: shipperContactPhone || shipperFacility.contactPhoneE164 || shipperFacility.dockContactPhone, email: shipperContactEmail || shipperFacility.receivingEmail, street: shipperFacility.street, city: shipperFacility.city, countryCode: shipperFacility.countryCode, postalCode: shipperFacility.postalCode }
        : { facilityName: shipperName, contactPerson: shipperContactName || undefined, phoneE164: shipperContactPhone || undefined, email: shipperContactEmail || undefined },
      consignee: consigneeManualEntry
        ? { facilityName: consigneeName, contactPerson: consigneeContactName || undefined, phoneE164: consigneeContactPhone || undefined, email: consigneeContactEmail || undefined, street: consigneeStreet, city: consigneeCity, stateOrProvince: consigneeStateOrProvince || undefined, countryCode: consigneeCountryCode, postalCode: consigneePostalCode || undefined }
        : consigneeFacility
        ? { facilityName: consigneeFacility.name, contactPerson: consigneeContactName || consigneeFacility.dockContactName, phoneE164: consigneeContactPhone || consigneeFacility.contactPhoneE164 || consigneeFacility.dockContactPhone, email: consigneeContactEmail || consigneeFacility.receivingEmail, street: consigneeFacility.street, city: consigneeFacility.city, countryCode: consigneeFacility.countryCode, postalCode: consigneeFacility.postalCode }
        : { facilityName: consigneeName, contactPerson: consigneeContactName || undefined, phoneE164: consigneeContactPhone || undefined, email: consigneeContactEmail || undefined },
      cargo: {
        handlingUnits: handlingUnits
          .filter((u) => u.quantity)
          .map((u) => ({
            quantity: Number(u.quantity),
            packagingType: u.packagingType,
            lengthIn: u.lengthIn ? (dimensionUnit === "cm" ? cmToIn(Number(u.lengthIn)) : Number(u.lengthIn)) : undefined,
            widthIn: u.widthIn ? (dimensionUnit === "cm" ? cmToIn(Number(u.widthIn)) : Number(u.widthIn)) : undefined,
            heightIn: u.heightIn ? (dimensionUnit === "cm" ? cmToIn(Number(u.heightIn)) : Number(u.heightIn)) : undefined,
          })),
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
        documentsSentToBroker,
      },
      billing: {
        billingTerms: billingOption === "carrier_account" ? "Prepaid" : "Third-Party",
        carrierName: billingOption === "carrier_account" ? carrierAccountName : undefined,
      },
      pickupWindow:
        pickupDate || dockAvailableAtPickup !== undefined || pickupAppointmentRequired !== undefined
          ? { dateIso: pickupDate || undefined, startTime: pickupStart || undefined, endTime: pickupEnd || undefined, dockAvailable: dockAvailableAtPickup, strictAppointment: pickupAppointmentRequired }
          : undefined,
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
            <p className="text-xs text-slate-500">Step {step} of 5</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-cyan-500 transition-all" style={{ width: `${(step / 5) * 100}%` }} />
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
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-mono uppercase tracking-wide text-slate-500">Shipper facility</label>
                    <button
                      type="button"
                      onClick={() => setShipperManualEntry((v) => !v)}
                      className="text-xs font-medium text-cyan-700 hover:underline"
                    >
                      {shipperManualEntry ? "Use a saved facility" : "+ Enter manually"}
                    </button>
                  </div>

                  {shipperManualEntry ? (
                    <div className="space-y-2 rounded-md border border-slate-400 bg-white p-3">
                      <input value={shipperName} onChange={(e) => setShipperName(e.target.value)} placeholder="Company / facility name" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      <AddressAutocompleteInput
                        value={shipperStreet}
                        onChange={setShipperStreet}
                        placeholder="Street address"
                        onSelect={(s: AddressSuggestion) => {
                          setShipperStreet(s.streetNumber && s.streetName ? `${s.streetNumber} ${s.streetName}` : s.freeformAddress);
                          if (s.municipality) setShipperCity(s.municipality);
                          if (s.countrySubdivisionCode) setShipperStateOrProvince(s.countrySubdivisionCode);
                          if (s.postalCode) setShipperPostalCode(s.postalCode);
                          if (s.countryCode) setShipperCountryCode(s.countryCode);
                        }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input value={shipperCity} onChange={(e) => setShipperCity(e.target.value)} placeholder="City" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                        <input value={shipperStateOrProvince} onChange={(e) => setShipperStateOrProvince(e.target.value)} placeholder="State / Province" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={shipperCountryCode} onChange={(e) => setShipperCountryCode(e.target.value)} className="rounded-md border border-slate-400 px-3 py-2 text-sm">
                          <option value="CA">Canada</option>
                          <option value="US">United States</option>
                          <option value="MX">Mexico</option>
                        </select>
                        <input value={shipperPostalCode} onChange={(e) => setShipperPostalCode(e.target.value)} placeholder="Postal / ZIP code" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  ) : savedFacilities.filter((f) => f.role !== "consignee").length > 0 ? (
                    <select
                      value={selectedShipperId}
                      onChange={(e) => {
                        setSelectedShipperId(e.target.value);
                        const f = savedFacilities.find((f) => f.id === e.target.value);
                        if (f) setShipperName(f.name);
                      }}
                      className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm"
                    >
                      <option value="">Select a saved facility...</option>
                      {savedFacilities.filter((f) => f.role !== "consignee").map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={shipperName} onChange={(e) => setShipperName(e.target.value)} placeholder="Meridian Cold Chain" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  )}

                  {!shipperManualEntry && shipperFacility && (
                    <div className="mt-2 rounded-md border border-slate-400 bg-slate-50 p-2.5 text-xs text-slate-600">
                      <p>{shipperFacility.street}, {shipperFacility.city}, {shipperFacility.stateOrProvince}</p>
                      {(shipperFacility.receivingHoursStart || shipperFacility.receivingHoursEnd) && (
                        <p className="mt-1 text-slate-500">Dock hours: {shipperFacility.receivingHoursStart ?? "—"}–{shipperFacility.receivingHoursEnd ?? "—"}</p>
                      )}
                      {shipperFacility.dockContactName && <p className="text-slate-500">Dock contact on file: {shipperFacility.dockContactName}{shipperFacility.dockContactPhone ? ` · ${shipperFacility.dockContactPhone}` : ""}</p>}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input value={shipperContactName} onChange={(e) => setShipperContactName(e.target.value)} placeholder={shipperFacility?.dockContactName ? `Contact (default: ${shipperFacility.dockContactName})` : "Contact name"} className="rounded-md border border-slate-400 px-3 py-2 text-xs" />
                    <input value={shipperContactPhone} onChange={(e) => setShipperContactPhone(e.target.value)} placeholder="Phone for this shipment" className="rounded-md border border-slate-400 px-3 py-2 text-xs" />
                    <input value={shipperContactEmail} onChange={(e) => setShipperContactEmail(e.target.value)} placeholder="Email for this shipment" className="col-span-2 rounded-md border border-slate-400 px-3 py-2 text-xs" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-mono uppercase tracking-wide text-slate-500">Consignee facility</label>
                    <button
                      type="button"
                      onClick={() => setConsigneeManualEntry((v) => !v)}
                      className="text-xs font-medium text-cyan-700 hover:underline"
                    >
                      {consigneeManualEntry ? "Use a saved facility" : "+ Enter manually"}
                    </button>
                  </div>

                  {consigneeManualEntry ? (
                    <div className="space-y-2 rounded-md border border-slate-400 bg-white p-3">
                      <input value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} placeholder="Company / facility name" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      <AddressAutocompleteInput
                        value={consigneeStreet}
                        onChange={setConsigneeStreet}
                        placeholder="Street address"
                        onSelect={(s: AddressSuggestion) => {
                          setConsigneeStreet(s.streetNumber && s.streetName ? `${s.streetNumber} ${s.streetName}` : s.freeformAddress);
                          if (s.municipality) setConsigneeCity(s.municipality);
                          if (s.countrySubdivisionCode) setConsigneeStateOrProvince(s.countrySubdivisionCode);
                          if (s.postalCode) setConsigneePostalCode(s.postalCode);
                          if (s.countryCode) setConsigneeCountryCode(s.countryCode);
                        }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input value={consigneeCity} onChange={(e) => setConsigneeCity(e.target.value)} placeholder="City" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                        <input value={consigneeStateOrProvince} onChange={(e) => setConsigneeStateOrProvince(e.target.value)} placeholder="State / Province" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={consigneeCountryCode} onChange={(e) => setConsigneeCountryCode(e.target.value)} className="rounded-md border border-slate-400 px-3 py-2 text-sm">
                          <option value="US">United States</option>
                          <option value="CA">Canada</option>
                          <option value="MX">Mexico</option>
                        </select>
                        <input value={consigneePostalCode} onChange={(e) => setConsigneePostalCode(e.target.value)} placeholder="Postal / ZIP code" className="rounded-md border border-slate-400 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  ) : savedFacilities.filter((f) => f.role !== "shipper").length > 0 ? (
                    <select
                      value={selectedConsigneeId}
                      onChange={(e) => {
                        setSelectedConsigneeId(e.target.value);
                        const f = savedFacilities.find((f) => f.id === e.target.value);
                        if (f) setConsigneeName(f.name);
                      }}
                      className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm"
                    >
                      <option value="">Select a saved facility...</option>
                      {savedFacilities.filter((f) => f.role !== "shipper").map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} placeholder="Bellingham DC" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  )}

                  {!consigneeManualEntry && consigneeFacility && (
                    <div className="mt-2 rounded-md border border-slate-400 bg-slate-50 p-2.5 text-xs text-slate-600">
                      <p>{consigneeFacility.street}, {consigneeFacility.city}, {consigneeFacility.stateOrProvince}</p>
                      {(consigneeFacility.receivingHoursStart || consigneeFacility.receivingHoursEnd) && (
                        <p className="mt-1 text-slate-500">Dock hours: {consigneeFacility.receivingHoursStart ?? "—"}–{consigneeFacility.receivingHoursEnd ?? "—"}</p>
                      )}
                      {consigneeFacility.dockContactName && <p className="text-slate-500">Dock contact on file: {consigneeFacility.dockContactName}{consigneeFacility.dockContactPhone ? ` · ${consigneeFacility.dockContactPhone}` : ""}</p>}
                      {consigneeFacility.receivingEmail && <p className="text-slate-500">Receiving email: {consigneeFacility.receivingEmail}</p>}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input value={consigneeContactName} onChange={(e) => setConsigneeContactName(e.target.value)} placeholder={consigneeFacility?.dockContactName ? `Contact (default: ${consigneeFacility.dockContactName})` : "Contact name"} className="rounded-md border border-slate-400 px-3 py-2 text-xs" />
                    <input value={consigneeContactPhone} onChange={(e) => setConsigneeContactPhone(e.target.value)} placeholder="Phone for this shipment" className="rounded-md border border-slate-400 px-3 py-2 text-xs" />
                    <input value={consigneeContactEmail} onChange={(e) => setConsigneeContactEmail(e.target.value)} placeholder="Email for this shipment" className="col-span-2 rounded-md border border-slate-400 px-3 py-2 text-xs" />
                  </div>
                </div>
              </div>

              {mode === "road" && (
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Border crossing</label>
                  <select value={borderCrossing} onChange={(e) => setBorderCrossing(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm">
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
                    <input value={railRampOrigin} onChange={(e) => setRailRampOrigin(e.target.value)} placeholder="CPKC Vancouver / CN Surrey" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Rail ramp destination</label>
                    <input value={railRampDestination} onChange={(e) => setRailRampDestination(e.target.value)} placeholder="e.g. CN Chicago" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Container #</label>
                    <input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Chassis #</label>
                    <input value={chassisNumber} onChange={(e) => setChassisNumber(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              {mode === "ocean" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Port of loading</label>
                    <input value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} placeholder="Shanghai" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Port of discharge</label>
                    <input value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)} placeholder="Vancouver" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              {mode === "air" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Origin airport (IATA)</label>
                    <input value={originIata} onChange={(e) => setOriginIata(e.target.value.toUpperCase())} placeholder="YVR" maxLength={3} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm uppercase" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Destination airport (IATA)</label>
                    <input value={destIata} onChange={(e) => setDestIata(e.target.value.toUpperCase())} placeholder="LHR" maxLength={3} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm uppercase" />
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
                  <div className="flex items-center gap-3">
                    <span className="flex rounded-md border border-slate-400 text-[10px] font-semibold">
                      <button type="button" onClick={() => handleDimensionUnitChange("in")} className={`px-2 py-1 ${dimensionUnit === "in" ? "bg-slate-900 text-white" : "text-slate-500"}`}>in</button>
                      <button type="button" onClick={() => handleDimensionUnitChange("cm")} className={`px-2 py-1 ${dimensionUnit === "cm" ? "bg-slate-900 text-white" : "text-slate-500"}`}>cm</button>
                    </span>
                    <button onClick={addHandlingUnit} className="flex items-center gap-1 text-xs font-semibold text-cyan-600 hover:text-cyan-700">
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-slate-400">L / W / H per unit, in {dimensionUnit === "in" ? "inches" : "centimeters"}</p>
                {handlingUnits.map((u, i) => (
                  <div key={i} className="mb-2 grid grid-cols-6 gap-2">
                    <input value={u.quantity} onChange={(e) => updateHandlingUnit(i, "quantity", e.target.value)} placeholder="Qty" className="col-span-1 rounded-md border border-slate-400 px-2 py-1.5 text-xs" />
                    <select value={u.packagingType} onChange={(e) => updateHandlingUnit(i, "packagingType", e.target.value)} className="col-span-2 rounded-md border border-slate-400 px-2 py-1.5 text-xs">
                      <option value="pallet">Pallet</option>
                      <option value="crate">Crate</option>
                      <option value="drum">Drum</option>
                      <option value="gaylord">Gaylord</option>
                      <option value="loose">Loose Unit</option>
                    </select>
                    <input value={u.lengthIn} onChange={(e) => updateHandlingUnit(i, "lengthIn", e.target.value)} placeholder={`L (${dimensionUnit})`} className="col-span-1 rounded-md border border-slate-400 px-2 py-1.5 text-xs" />
                    <input value={u.widthIn} onChange={(e) => updateHandlingUnit(i, "widthIn", e.target.value)} placeholder={`W (${dimensionUnit})`} className="col-span-1 rounded-md border border-slate-400 px-2 py-1.5 text-xs" />
                    {handlingUnits.length > 1 ? (
                      <button onClick={() => removeHandlingUnit(i)} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-rose-500">
                        <Trash2 size={13} />
                      </button>
                    ) : (
                      <input value={u.heightIn} onChange={(e) => updateHandlingUnit(i, "heightIn", e.target.value)} placeholder={`H (${dimensionUnit})`} className="col-span-1 rounded-md border border-slate-400 px-2 py-1.5 text-xs" />
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 flex items-center justify-between text-xs font-mono uppercase tracking-wide text-slate-500">
                    Total gross weight
                    <span className="flex rounded border border-slate-400 text-[10px] font-semibold normal-case">
                      <button type="button" onClick={() => handleWeightUnitChange("lbs")} className={`px-1.5 py-0.5 ${weightUnit === "lbs" ? "bg-slate-900 text-white" : "text-slate-500"}`}>lbs</button>
                      <button type="button" onClick={() => handleWeightUnitChange("kg")} className={`px-1.5 py-0.5 ${weightUnit === "kg" ? "bg-slate-900 text-white" : "text-slate-500"}`}>kg</button>
                    </span>
                  </label>
                  <input value={totalWeightLbs} onChange={(e) => setTotalWeightLbs(e.target.value)} placeholder="8000" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
                    <input type="checkbox" checked={reeferEnabled} onChange={(e) => setReeferEnabled(e.target.checked)} className="rounded border-slate-400" />
                    Temperature control
                  </label>
                  {reeferEnabled && (
                    <>
                      <input value={reeferTempF} onChange={(e) => setReeferTempF(e.target.value)} placeholder={`°${reeferTempUnit} (required)`} className={`w-24 rounded-md border px-2 py-2 text-sm ${reeferTempF.trim() ? "border-slate-400" : "border-amber-500 bg-amber-50"}`} />
                      <select value={reeferTempUnit} onChange={(e) => setReeferTempUnit(e.target.value as "F" | "C")} className="rounded-md border border-slate-400 px-1 py-2 text-xs">
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
                  <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Total cartons</label>
                  <input value={totalCartons} onChange={(e) => setTotalCartons(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">NMFC freight class</label>
                  <div className="relative flex gap-1">
                    <input value={freightClass} onChange={(e) => setFreightClass(e.target.value)} placeholder="e.g. 85" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                    <button type="button" onClick={() => setShowDensityCalc((v) => !v)} title="Calculate from dimensions & weight" className="rounded-md border border-slate-400 px-2 text-slate-500 hover:bg-slate-50">
                      <Calculator size={14} />
                    </button>
                    {showDensityCalc && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                        <p className="mb-1 text-xs font-semibold text-slate-600">Calculated from your first handling unit</p>
                        <p className="mb-2 text-xs text-slate-400">Uses the L/W/H/qty entered above + total gross weight.</p>
                        {densityResult ? (
                          <p className="mb-2 text-xs text-slate-600">
                            {densityResult.densityPcf} PCF → <strong className="text-slate-800">Class {densityResult.freightClass}</strong>
                          </p>
                        ) : (
                          <p className="mb-2 text-xs text-amber-600">Enter L/W/H, quantity, and gross weight above first.</p>
                        )}
                        <button
                          onClick={() => {
                            if (densityResult) setFreightClass(densityResult.freightClass);
                            setShowDensityCalc(false);
                          }}
                          disabled={!densityResult}
                          className="w-full rounded-md bg-slate-900 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          Apply Calculated Class
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {mode === "road" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Equipment type</label>
                    <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value as typeof equipmentType)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm">
                      <option value="dry_van_53">53' Dry Van</option>
                      <option value="reefer_53">53' Reefer</option>
                      <option value="flatbed_48">Flatbed</option>
                      <option value="stepdeck">Step Deck</option>
                    </select>
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-xs text-slate-600">
                    <input type="checkbox" checked={tailgateRequired} onChange={(e) => setTailgateRequired(e.target.checked)} className="rounded border-slate-400" />
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
                      <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} className="rounded-md border border-slate-400 px-1.5 py-2 text-xs">
                        <option>USD</option>
                        <option>CAD</option>
                        <option>EUR</option>
                      </select>
                      <input value={invoiceValue} onChange={(e) => setInvoiceValue(e.target.value)} placeholder="20000" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">HTS/HS code</label>
                    <input value={htsCode} onChange={(e) => setHtsCode(e.target.value)} placeholder="3808.91.5010" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Country of origin</label>
                    <select value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm">
                      <option value="CA">Canada</option>
                      <option value="US">United States</option>
                      <option value="MX">Mexico</option>
                      <option value="OTHER">Other (specify in notes)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
                      <input type="checkbox" checked={isHazmat} onChange={(e) => setIsHazmat(e.target.checked)} className="rounded border-slate-400" />
                      Hazardous materials
                    </label>
                  </div>
                </div>
                {isHazmat && (
                  <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-200 pt-3">
                    <input value={unNumber} onChange={(e) => setUnNumber(e.target.value)} placeholder="UN Number (required)" className={`rounded-md border px-3 py-2 text-sm ${unNumber.trim() ? "border-slate-400" : "border-amber-500 bg-amber-50"}`} />
                    <input value={hazardClass} onChange={(e) => setHazardClass(e.target.value)} placeholder="Hazard Class 1-9 (required)" className={`rounded-md border px-3 py-2 text-sm ${hazardClass.trim() ? "border-slate-400" : "border-amber-500 bg-amber-50"}`} />
                    <select value={packingGroup} onChange={(e) => setPackingGroup(e.target.value as typeof packingGroup)} className="rounded-md border border-slate-400 px-3 py-2 text-sm">
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
                    <input value={customsBrokerName} onChange={(e) => setCustomsBrokerName(e.target.value)} placeholder="e.g. Livingston International" className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                  </div>
                  {mode === "road" && (
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">PAPS/PARS barcode #</label>
                      <input value={papsParsBarcode} onChange={(e) => setPapsParsBarcode(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm" />
                    </div>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Pickup window</label>
                    <div className="flex gap-1">
                      <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className="flex-1 rounded-md border border-slate-400 px-2 py-2 text-xs" />
                      <input type="time" value={pickupStart} onChange={(e) => setPickupStart(e.target.value)} className="w-20 rounded-md border border-slate-400 px-2 py-2 text-xs" />
                      <input type="time" value={pickupEnd} onChange={(e) => setPickupEnd(e.target.value)} className="w-20 rounded-md border border-slate-400 px-2 py-2 text-xs" />
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <YesNoQuestion label="Is a dock available at pickup?" value={dockAvailableAtPickup} onChange={setDockAvailableAtPickup} />
                      <YesNoQuestion label="Is a pickup appointment needed?" value={pickupAppointmentRequired} onChange={setPickupAppointmentRequired} />
                    </div>
                    {pickupAppointmentRequired && (
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5">
                        <p className="mb-1.5 text-[11px] font-semibold text-amber-800">Contact to book the pickup appointment</p>
                        {(() => {
                          const resolvedName = shipperContactName || shipperFacility?.dockContactName;
                          const resolvedPhone = shipperContactPhone || shipperFacility?.dockContactPhone || shipperFacility?.contactPhoneE164;
                          const resolvedEmail = shipperContactEmail || shipperFacility?.receivingEmail;
                          if (resolvedName && resolvedPhone && resolvedEmail) {
                            return (
                              <p className="text-xs text-amber-700">
                                Already on file: {resolvedName} · {resolvedPhone} · {resolvedEmail}
                              </p>
                            );
                          }
                          return (
                            <>
                              <p className="mb-1.5 text-[11px] text-amber-700">Not fully on file yet — fill in below (this also updates your Shipper contact in Step 1).</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                <input value={shipperContactName} onChange={(e) => setShipperContactName(e.target.value)} placeholder={resolvedName ? `Name (default: ${resolvedName})` : "Name"} className="rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                                <input value={shipperContactPhone} onChange={(e) => setShipperContactPhone(e.target.value)} placeholder={resolvedPhone ? `Phone (default: ${resolvedPhone})` : "Phone"} className="rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                                <input value={shipperContactEmail} onChange={(e) => setShipperContactEmail(e.target.value)} placeholder={resolvedEmail ? `Email (default: ${resolvedEmail})` : "Email"} className="col-span-2 rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Delivery window</label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="flex-1 rounded-md border border-slate-400 px-2 py-2 text-xs" />
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
                        <input type="checkbox" checked={strictAppointment} onChange={(e) => setStrictAppointment(e.target.checked)} className="rounded border-slate-400" />
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
                    PDF-to-text extraction isn't wired up in this build yet — paste the invoice or packing list text below and it's parsed automatically.
                  </p>
                  <textarea
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    placeholder="Paste commercial invoice or packing list text here..."
                    rows={6}
                    className="w-full rounded-lg border border-slate-400 p-3 font-mono text-xs"
                  />
                  <button
                    onClick={handleParseDocument}
                    disabled={parsing || !documentText.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-400 p-4 text-slate-500 hover:border-cyan-400 hover:bg-cyan-50/50 disabled:cursor-not-allowed disabled:opacity-60"
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
                <select value={carrierAccountName} onChange={(e) => setCarrierAccountName(e.target.value)} className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm">
                  <option>ODFL</option>
                  <option>FedEx Freight</option>
                  <option>Maersk</option>
                </select>
              )}

              {strictAppointment && (
                <div className={`rounded-md border p-2.5 ${billingOption === "house_spot" ? "border-amber-300 bg-amber-50" : "border-slate-400 bg-slate-50"}`}>
                  <p className={`mb-1.5 text-[11px] font-semibold ${billingOption === "house_spot" ? "text-amber-800" : "text-slate-600"}`}>Contact to book the delivery appointment</p>
                  {billingOption === "carrier_account" ? (
                    <p className="text-xs text-slate-500">
                      Not needed here — {carrierAccountName} already has your delivery contact on file through your carrier account.
                    </p>
                  ) : (
                    (() => {
                      const resolvedName = consigneeContactName || consigneeFacility?.dockContactName;
                      const resolvedPhone = consigneeContactPhone || consigneeFacility?.dockContactPhone || consigneeFacility?.contactPhoneE164;
                      const resolvedEmail = consigneeContactEmail || consigneeFacility?.receivingEmail;
                      if (resolvedName && resolvedPhone && resolvedEmail) {
                        return (
                          <p className="text-xs text-amber-700">
                            Already on file: {resolvedName} · {resolvedPhone} · {resolvedEmail}
                          </p>
                        );
                      }
                      return (
                        <>
                          <p className="mb-1.5 text-[11px] text-amber-700">Booking via Pascal's house spot rate — we need this to book the appointment directly. Fill in below (also updates your Consignee contact in Step 1).</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input value={consigneeContactName} onChange={(e) => setConsigneeContactName(e.target.value)} placeholder={resolvedName ? `Name (default: ${resolvedName})` : "Name"} className="rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                            <input value={consigneeContactPhone} onChange={(e) => setConsigneeContactPhone(e.target.value)} placeholder={resolvedPhone ? `Phone (default: ${resolvedPhone})` : "Phone"} className="rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                            <input value={consigneeContactEmail} onChange={(e) => setConsigneeContactEmail(e.target.value)} placeholder={resolvedEmail ? `Email (default: ${resolvedEmail})` : "Email"} className="col-span-2 rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs" />
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              )}

              <div className="rounded-lg border border-slate-400 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-mono uppercase tracking-wide text-slate-500">Facility SOP summary</p>
                {consigneeFacility ? (
                  <p className="text-xs text-slate-600">
                    Receiving hours {consigneeFacility.receivingHoursStart ?? "—"}–{consigneeFacility.receivingHoursEnd ?? "—"}.
                    {consigneeFacility.dockContactName ? ` Dock contact: ${consigneeFacility.dockContactName}` : ""}
                    {consigneeFacility.dockContactPhone ? ` · ${consigneeFacility.dockContactPhone}` : ""}
                    {consigneeFacility.receivingEmail ? ` · ${consigneeFacility.receivingEmail}` : ""}
                    {consigneeFacility.dockContactName ? "." : ""}
                  </p>
                ) : (
                  <p className="rounded-md border border-amber-500 bg-amber-100 px-2.5 py-2 text-xs font-semibold text-amber-900">No saved facility SOP on file for this consignee — confirm dock rules directly before dispatch.</p>
                )}
              </div>

              <div className={`rounded-lg border p-3 ${customsBrokerName.trim() ? "border-slate-400 bg-slate-50" : "border-amber-500 bg-amber-100"}`}>
                <p className={`mb-1 text-xs font-mono uppercase tracking-wide ${customsBrokerName.trim() ? "text-slate-500" : "text-amber-900 font-bold"}`}>Customs broker confirmation</p>
                {customsBrokerName.trim() ? (
                  <p className="text-xs text-slate-600">Broker of record: {customsBrokerName}</p>
                ) : (
                  <p className="text-xs font-semibold text-amber-900">No customs broker entered in Step 2 — required for cross-border clearance. Go back and add one before submitting.</p>
                )}
                <div className="mt-2">
                  <YesNoQuestion
                    label="Has the commercial invoice & packing list been sent to the broker?"
                    value={documentsSentToBroker}
                    onChange={setDocumentsSentToBroker}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Not sure? That's fine — Pascal confirms directly with the broker before dispatch either way.</p>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border-2 border-amber-500 bg-amber-100 p-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-900" />
                <p className="text-xs font-semibold text-amber-900">
                  This shipment crosses an international border and cannot be corrected once dispatched. Review every field below carefully before submitting.
                </p>
              </div>

              <ReviewSection title="Transport Mode">
                <ReviewRow label="Mode" value={MODE_LABEL[mode]} />
                {mode === "road" && <ReviewRow label="Border crossing" value={borderCrossing} />}
                {mode === "rail" && (
                  <>
                    <ReviewRow label="Rail ramp origin" value={railRampOrigin} />
                    <ReviewRow label="Rail ramp destination" value={railRampDestination} />
                    {containerNumber && <ReviewRow label="Container #" value={containerNumber} />}
                    {chassisNumber && <ReviewRow label="Chassis #" value={chassisNumber} />}
                  </>
                )}
                {mode === "ocean" && (
                  <>
                    <ReviewRow label="Port of loading" value={portOfLoading} />
                    <ReviewRow label="Port of discharge" value={portOfDischarge} />
                  </>
                )}
                {mode === "air" && (
                  <>
                    <ReviewRow label="Origin airport" value={originIata} />
                    <ReviewRow label="Destination airport" value={destIata} />
                  </>
                )}
              </ReviewSection>

              <div className="grid grid-cols-2 gap-3">
                <ReviewSection title="Shipper">
                  <ReviewRow label="Name" value={shipperManualEntry ? shipperName : shipperFacility?.name ?? shipperName} />
                  <ReviewRow
                    label="Address"
                    value={shipperManualEntry ? [shipperStreet, shipperCity, shipperStateOrProvince, shipperPostalCode, COUNTRY_LABEL[shipperCountryCode] ?? shipperCountryCode].filter(Boolean).join(", ") : shipperFacility ? `${shipperFacility.street}, ${shipperFacility.city}, ${shipperFacility.stateOrProvince} ${shipperFacility.postalCode ?? ""}`.trim() : "—"}
                  />
                  <ReviewRow label="Contact" value={shipperContactName || shipperFacility?.dockContactName || "—"} />
                  <ReviewRow label="Phone" value={shipperContactPhone || shipperFacility?.dockContactPhone || shipperFacility?.contactPhoneE164 || "—"} />
                  <ReviewRow label="Email" value={shipperContactEmail || shipperFacility?.receivingEmail || "—"} />
                </ReviewSection>
                <ReviewSection title="Consignee">
                  <ReviewRow label="Name" value={consigneeManualEntry ? consigneeName : consigneeFacility?.name ?? consigneeName} />
                  <ReviewRow
                    label="Address"
                    value={consigneeManualEntry ? [consigneeStreet, consigneeCity, consigneeStateOrProvince, consigneePostalCode, COUNTRY_LABEL[consigneeCountryCode] ?? consigneeCountryCode].filter(Boolean).join(", ") : consigneeFacility ? `${consigneeFacility.street}, ${consigneeFacility.city}, ${consigneeFacility.stateOrProvince} ${consigneeFacility.postalCode ?? ""}`.trim() : "—"}
                  />
                  <ReviewRow label="Contact" value={consigneeContactName || consigneeFacility?.dockContactName || "—"} />
                  <ReviewRow label="Phone" value={consigneeContactPhone || consigneeFacility?.dockContactPhone || consigneeFacility?.contactPhoneE164 || "—"} />
                  <ReviewRow label="Email" value={consigneeContactEmail || consigneeFacility?.receivingEmail || "—"} />
                </ReviewSection>
              </div>

              <ReviewSection title="Cargo">
                {poNumber && <ReviewRow label="PO / Order #" value={poNumber} />}
                <ReviewRow label="Handling units" value={handlingUnits.filter((u) => u.quantity).map((u) => `${u.quantity}× ${u.packagingType}${u.lengthIn && u.widthIn && u.heightIn ? ` (${u.lengthIn}×${u.widthIn}×${u.heightIn}${dimensionUnit})` : ""}`).join(", ") || "—"} />
                {totalCartons && <ReviewRow label="Total cartons" value={totalCartons} />}
                <ReviewRow label="Gross weight" value={totalWeightLbs ? `${totalWeightLbs} ${weightUnit}` : "—"} />
                {freightClass && <ReviewRow label="Freight class" value={freightClass} />}
                {mode === "road" && <ReviewRow label="Equipment" value={`${EQUIPMENT_LABEL[equipmentType]}${tailgateRequired ? " · Tailgate required" : ""}`} />}
                {reeferEnabled && reeferTempF && <ReviewRow label="Temperature control" value={`${reeferTempF}°${reeferTempUnit}`} />}
              </ReviewSection>

              <ReviewSection title="Customs Compliance">
                <ReviewRow label="Commercial invoice value" value={invoiceValue ? `$${invoiceValue} ${currency}` : "—"} />
                <ReviewRow label="HTS / HS code" value={htsCode || "—"} />
                <ReviewRow label="Country of origin" value={COUNTRY_LABEL[countryOfOrigin] ?? countryOfOrigin} />
                {isHazmat && <ReviewRow label="Hazmat" value={`UN${unNumber || "—"} · Class ${hazardClass || "—"} · PG ${packingGroup}`} highlight />}
                <ReviewRow label="Customs broker" value={customsBrokerName || "Not on file"} highlight={!customsBrokerName} />
                {documentsSentToBroker !== undefined && <ReviewRow label="Invoice/packing list sent to broker" value={documentsSentToBroker ? "Yes" : "No — Pascal will confirm"} highlight={!documentsSentToBroker} />}
                {mode === "road" && papsParsBarcode && <ReviewRow label="PAPS/PARS barcode" value={papsParsBarcode} />}
              </ReviewSection>

              {(pickupDate || deliveryDate || dockAvailableAtPickup !== undefined || pickupAppointmentRequired !== undefined) && (
                <ReviewSection title="Scheduling">
                  {pickupDate && <ReviewRow label="Pickup window" value={`${pickupDate}${pickupStart ? ` ${pickupStart}` : ""}${pickupEnd ? `–${pickupEnd}` : ""}`} />}
                  {dockAvailableAtPickup !== undefined && <ReviewRow label="Dock available at pickup" value={dockAvailableAtPickup ? "Yes" : "No"} highlight={!dockAvailableAtPickup} />}
                  {pickupAppointmentRequired !== undefined && <ReviewRow label="Pickup appointment needed" value={pickupAppointmentRequired ? "Yes" : "No"} highlight={pickupAppointmentRequired} />}
                  {deliveryDate && <ReviewRow label="Delivery window" value={`${deliveryDate}${strictAppointment ? " · Strict appointment" : ""}`} />}
                </ReviewSection>
              )}

              <ReviewSection title="Carrier & Billing">
                <ReviewRow label="Billing" value={billingOption === "carrier_account" ? `Contracted account — ${carrierAccountName}` : "Pascal house spot rate"} />
              </ReviewSection>

              {submitError && <p className="text-xs text-rose-600">{submitError}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as WizardStep))} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
            <ChevronLeft size={13} /> {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 5 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as WizardStep)}
              disabled={!canAdvance}
              className="flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {step === 4 ? "Review" : "Continue"} <ChevronRight size={13} />
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

function YesNoQuestion({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-400 px-2.5 py-1.5">
      <span className="text-xs text-slate-600">{label}</span>
      <span className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${value === true ? "bg-slate-900 text-white" : "border border-slate-400 text-slate-500"}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${value === false ? "bg-slate-900 text-white" : "border border-slate-400 text-slate-500"}`}
        >
          No
        </button>
      </span>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-400 bg-white p-3">
      <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`text-right font-medium ${highlight ? "text-amber-900 font-bold" : "text-slate-800"}`}>{value || "—"}</span>
    </div>
  );
}
