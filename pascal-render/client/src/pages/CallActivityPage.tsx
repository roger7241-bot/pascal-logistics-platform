import { useEffect, useState, useRef } from "react";
import {
  Phone,
  PhoneCall,
  ShieldOff,
  Plus,
  Loader2,
  Flame,
  Voicemail,
  XCircle,
  CalendarClock,
  ChevronRight,
  BookOpen,
  ArrowRight,
  Copy,
  Check,
  CalendarPlus,
  Mail,
  FileStack,
  UploadCloud,
  Search,
  X,
  AlertTriangle,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Lead {
  id: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  segment?: string;
  estimatedMonthlyVolume?: string;
  targetLanes?: string;
  targetBorderCrossing?: string;
}

interface CallLog {
  id: string;
  contactName?: string;
  contactPhone?: string;
  calledAtIso: string;
  callOutcome?: string;
  sentiment?: string;
  keyNotesSummary?: string;
  transcriptText?: string;
}

interface DncEntry {
  id: string;
  contactValue: string;
  contactName?: string;
  optedOutAtIso: string;
  operatorName?: string;
}

const OUTCOME_CONFIG: Record<string, { label: string; class: string; icon: typeof Flame }> = {
  connected: { label: "Connected", class: "bg-sky-600 hover:bg-sky-500", icon: PhoneCall },
  voicemail: { label: "Voicemail", class: "bg-slate-500 hover:bg-slate-400", icon: Voicemail },
  not_interested: { label: "Not Interested", class: "bg-slate-500 hover:bg-slate-400", icon: XCircle },
  hot_lead: { label: "Hot Lead", class: "bg-rose-600 hover:bg-rose-500", icon: Flame },
  opt_out_dnc: { label: "Opt-Out / DNC", class: "bg-slate-800 hover:bg-slate-700", icon: ShieldOff },
};

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  connected: "bg-sky-100 text-sky-700",
  voicemail: "bg-slate-100 text-slate-600",
  not_interested: "bg-slate-100 text-slate-600",
  hot_lead: "bg-rose-100 text-rose-700",
  opt_out_dnc: "bg-slate-200 text-slate-700",
};

const TALKING_POINTS = [
  { objection: "Concerned about Pacific Highway / Blaine border delays", response: "We monitor live wait times across all 5 Lower Mainland crossings and auto-reroute when the economics work out — drivers get real-time camera snapshots, not guesses." },
  { objection: "Not sure their goods qualify for USMCA duty-free treatment", response: "We run a real qualification check against origin + HTS classification depth and generate the certificate automatically once it clears — no manual paperwork." },
  { objection: "Happy with current carrier rates", response: "Our Agent 3 benchmark compares their contracted rate against live spot market pricing — we only flag it when there's a genuine 15%+ savings opportunity, not a sales pitch." },
];

const TEXT_TRANSCRIPT_EXTENSIONS = [".txt", ".vtt", ".srt"];

export function CallActivityPage() {
  const [segments, setSegments] = useState<string[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<string>("");
  const [queue, setQueue] = useState<Lead[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);

  const [transcriptText, setTranscriptText] = useState("");
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logging, setLogging] = useState<string | undefined>(undefined);
  const [lastResult, setLastResult] = useState<{ scheduled?: string; blocked?: string } | undefined>(undefined);
  const [quickActionBusy, setQuickActionBusy] = useState<string | undefined>(undefined);
  const [quickActionNote, setQuickActionNote] = useState<string | undefined>(undefined);
  const [copiedIndex, setCopiedIndex] = useState<number | undefined>(undefined);

  const [calls, setCalls] = useState<CallLog[]>([]);
  const [callSearch, setCallSearch] = useState("");
  const [dnc, setDnc] = useState<DncEntry[]>([]);
  const [dncSearch, setDncSearch] = useState("");
  const [dncValue, setDncValue] = useState("");
  const [dncName, setDncName] = useState("");
  const [transcriptModal, setTranscriptModal] = useState<CallLog | undefined>(undefined);

  useEffect(() => {
    api.leadSegments<{ segments: string[] }>().then((d) => setSegments(d.segments));
  }, []);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callSearch, dncSearch]);

  const loadHistory = () => {
    Promise.all([api.callLogs<{ calls: CallLog[] }>(callSearch || undefined), api.dncList<{ entries: DncEntry[] }>(dncSearch || undefined)]).then(([c, d]) => {
      setCalls(c.calls);
      setDnc(d.entries);
    });
  };

  const startSession = async () => {
    if (!selectedSegment) return;
    const result = await api.leadsBySegment<{ leads: Lead[] }>(selectedSegment);
    setQueue(result.leads);
    setQueueIndex(0);
    setSessionActive(result.leads.length > 0);
    setTranscriptText("");
    setLastResult(undefined);
    setQuickActionNote(undefined);
  };

  const currentLead = queue[queueIndex];

  const advanceQueue = () => {
    if (queueIndex + 1 < queue.length) {
      setQueueIndex(queueIndex + 1);
      setTranscriptText("");
      setLastResult(undefined);
      setQuickActionNote(undefined);
    } else {
      setSessionActive(false);
    }
  };

  const handleOutcome = async (outcome: string) => {
    if (!currentLead) return;
    setLogging(outcome);
    try {
      const result = await api.logCall<{ scheduledDiscoveryCall: { title: string } | null }>({
        leadId: currentLead.id,
        contactName: currentLead.contactName ?? currentLead.companyName,
        contactPhone: currentLead.contactPhone,
        contactEmail: currentLead.contactEmail,
        callOutcome: outcome,
        transcriptText: transcriptText || undefined,
        operatorName: "Roger",
      });
      setLastResult({ scheduled: result.scheduledDiscoveryCall?.title });
      loadHistory();
      setTimeout(advanceQueue, 900);
    } catch (err) {
      setLastResult({ blocked: err instanceof Error ? err.message : "Could not log this call." });
    } finally {
      setLogging(undefined);
    }
  };

  const handleAddDnc = async () => {
    if (!dncValue.trim()) return;
    await api.addToDnc({ contactValue: dncValue, contactName: dncName || undefined, operatorName: "Roger" });
    setDncValue("");
    setDncName("");
    loadHistory();
  };

  const handleFile = async (file: File) => {
    setFileError(undefined);
    const isTextTranscript = TEXT_TRANSCRIPT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!isTextTranscript) {
      setFileError("Audio transcription isn't wired up yet — that needs a real speech-to-text service (Whisper, AssemblyAI, etc.) which isn't configured. Drop a .txt/.vtt/.srt transcript file, or paste text directly below.");
      return;
    }
    const text = await file.text();
    setTranscriptText((prev) => (prev ? `${prev}\n\n${text}` : text));
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(undefined), 1500);
  };

  const handleBookDiscoveryCall = async () => {
    if (!currentLead) return;
    setQuickActionBusy("book");
    setQuickActionNote(undefined);
    try {
      await api.createCalendarEvent({
        orgId: "org_meridian",
        title: `Discovery call — ${currentLead.contactName ?? currentLead.companyName}`,
        eventType: "other",
        startsAtIso: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        notes: `Booked from Call Activity Desk during live session with ${currentLead.companyName}.`,
      });
      setQuickActionNote("Discovery call booked on the shared calendar.");
    } finally {
      setQuickActionBusy(undefined);
    }
  };

  const handleSendRateProposal = async () => {
    if (!currentLead) return;
    setQuickActionBusy("proposal");
    setQuickActionNote(undefined);
    try {
      const result = await api.sendRateProposalEmail<{ emailResult: { simulated: boolean } }>(currentLead.id);
      setQuickActionNote(result.emailResult.simulated ? "Rate proposal email logged (simulated — no AgentMail key configured)." : "Rate proposal email sent.");
    } catch (err) {
      setQuickActionNote(err instanceof Error ? err.message : "Could not send the proposal.");
    } finally {
      setQuickActionBusy(undefined);
    }
  };

  const handleSendUsmcaPacket = async () => {
    if (!currentLead) return;
    setQuickActionBusy("usmca");
    setQuickActionNote(undefined);
    try {
      const result = await api.sendUsmcaPacket<{ emailResult: { simulated: boolean } }>(currentLead.id);
      setQuickActionNote(result.emailResult.simulated ? "USMCA packet logged (simulated — no AgentMail key configured)." : "USMCA packet sent.");
    } catch (err) {
      setQuickActionNote(err instanceof Error ? err.message : "Could not send the packet.");
    } finally {
      setQuickActionBusy(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Phone size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Sales Assist Hub</h1>
          <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Desk #5 / #6</span>
        </div>
        <p className="text-xs text-slate-400">Click-to-dial only — every call requires an explicit human click to initiate. No autodialer, no automated calling.</p>

        {!sessionActive && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <select value={selectedSegment} onChange={(e) => setSelectedSegment(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select a prospect segment...</option>
              {segments.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button onClick={startSession} disabled={!selectedSegment} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
              Start call session <ArrowRight size={14} />
            </button>
          </div>
        )}

        {sessionActive && currentLead && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-mono uppercase tracking-wide text-slate-500">
                    Prospect {queueIndex + 1} of {queue.length} — {selectedSegment}
                  </p>
                  <button onClick={() => setSessionActive(false)} className="text-xs text-slate-400 hover:text-slate-600">
                    End session
                  </button>
                </div>
                <p className="text-lg font-bold text-slate-900">{currentLead.companyName}</p>
                <p className="text-sm text-slate-600">{currentLead.contactName}</p>
                <p className="mb-2 font-mono text-sm text-slate-500">{currentLead.contactPhone}</p>
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {currentLead.estimatedMonthlyVolume && <span>Volume: {currentLead.estimatedMonthlyVolume}</span>}
                  {currentLead.targetLanes && <span>Lanes: {currentLead.targetLanes}</span>}
                  {currentLead.targetBorderCrossing && <span>Crossing: {currentLead.targetBorderCrossing.replace(/_/g, " ")}</span>}
                </div>

                {currentLead.contactPhone && (
                  <a href={`tel:${currentLead.contactPhone}`} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
                    <PhoneCall size={15} /> Click to dial {currentLead.contactPhone}
                  </a>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={handleBookDiscoveryCall} disabled={!!quickActionBusy} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {quickActionBusy === "book" ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />} Book Discovery Call
                </button>
                <button onClick={handleSendRateProposal} disabled={!!quickActionBusy} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {quickActionBusy === "proposal" ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send Rate Proposal Email
                </button>
                <button onClick={handleSendUsmcaPacket} disabled={!!quickActionBusy} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {quickActionBusy === "usmca" ? <Loader2 size={12} className="animate-spin" /> : <FileStack size={12} />} Dispatch USMCA Packet
                </button>
              </div>
              {quickActionNote && <p className="text-xs text-emerald-600">{quickActionNote}</p>}

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
                }}
                className={`rounded-md border-2 border-dashed p-2 ${dragOver ? "border-cyan-400 bg-cyan-50" : "border-slate-200"}`}
              >
                <textarea
                  value={transcriptText}
                  onChange={(e) => setTranscriptText(e.target.value)}
                  placeholder="Live notes — type during the call, or drop a .txt/.vtt/.srt transcript file here..."
                  rows={4}
                  className="w-full resize-none border-none bg-transparent px-1 py-1 text-xs outline-none"
                />
                <div className="flex items-center justify-between px-1">
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
                    <UploadCloud size={12} /> Upload transcript file
                  </button>
                  <input ref={fileInputRef} type="file" accept=".txt,.vtt,.srt,.mp3,.wav,.m4a" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </div>
              </div>
              {fileError && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {fileError}
                </p>
              )}

              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Log outcome</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(OUTCOME_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    return (
                      <button key={key} onClick={() => handleOutcome(key)} disabled={!!logging} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${cfg.class}`}>
                        {logging === key ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {cfg.label}
                      </button>
                    );
                  })}
                </div>
                {lastResult?.scheduled && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600">
                    <CalendarClock size={12} /> Hot lead — auto-scheduled: {lastResult.scheduled}
                  </p>
                )}
                {lastResult?.blocked && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
                    <ShieldOff size={12} /> {lastResult.blocked}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-cyan-400">
                <BookOpen size={12} /> Live Assist Teleprompter
              </p>
              <div className="space-y-2.5">
                {TALKING_POINTS.map((tp, i) => (
                  <div key={i} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1 text-xs font-semibold text-amber-300">
                        <ChevronRight size={11} /> {tp.objection}
                      </p>
                      <button onClick={() => handleCopy(tp.response, i)} className="shrink-0 text-slate-400 hover:text-slate-200">
                        {copiedIndex === i ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-300">{tp.response}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={callSearch} onChange={(e) => setCallSearch(e.target.value)} placeholder="Search call log by name, phone, or email..." className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm" />
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {calls.map((call) => (
                <button key={call.id} onClick={() => call.transcriptText && setTranscriptModal(call)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-semibold text-slate-900">{call.contactName ?? "Unknown"}</p>
                      <span className="text-xs text-slate-400">{new Date(call.calledAtIso).toLocaleString()}</span>
                      {call.callOutcome && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${OUTCOME_BADGE_CLASS[call.callOutcome]}`}>{OUTCOME_CONFIG[call.callOutcome]?.label}</span>}
                    </div>
                    {call.keyNotesSummary && <p className="mt-1 text-xs text-slate-500">{call.keyNotesSummary}</p>}
                  </div>
                  {call.transcriptText && <span className="shrink-0 text-xs text-cyan-600">View transcript</span>}
                </button>
              ))}
              {calls.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No calls logged yet.</p>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-slate-500">
                <ShieldOff size={12} /> Add to DNC registry
              </p>
              <input value={dncName} onChange={(e) => setDncName(e.target.value)} placeholder="Contact name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={dncValue} onChange={(e) => setDncValue(e.target.value)} placeholder="Phone or email" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={handleAddDnc} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                <Plus size={12} /> Add to Do-Not-Contact
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-3">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={dncSearch} onChange={(e) => setDncSearch(e.target.value)} placeholder="Search DNC registry..." className="w-full rounded-md border border-slate-300 py-1.5 pl-7 pr-2 text-xs" />
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {dnc.map((entry) => (
                  <div key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs font-semibold text-slate-800">{entry.contactName ?? "Unnamed"}</p>
                    <p className="font-mono text-xs text-slate-500">{entry.contactValue}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(entry.optedOutAtIso).toLocaleDateString()} {entry.operatorName && `· ${entry.operatorName}`}
                    </p>
                  </div>
                ))}
                {dnc.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">Registry is empty.</p>}
              </div>
            </div>
          </div>
        </div>
      </main>

      {transcriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTranscriptModal(undefined)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">{transcriptModal.contactName} — full transcript</p>
              <button onClick={() => setTranscriptModal(undefined)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-xs text-slate-700">{transcriptModal.transcriptText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
