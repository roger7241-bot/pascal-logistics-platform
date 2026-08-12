import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { api } from "../config/api";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  simulated?: boolean;
}

export function ChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Hi — I'm Agent 5. Ask me about your shipments, POA status, or invoices." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || sending) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setSending(true);
    try {
      const result = await api.chat<{ reply: string; simulated: boolean }>("org_meridian", question);
      setMessages((prev) => [...prev, { role: "assistant", text: result.reply, simulated: result.simulated }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Sorry, something went wrong reaching the assistant." }]);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-600 text-white shadow-lg hover:bg-cyan-500"
      >
        <MessageCircle size={22} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[480px] w-80 flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between rounded-t-xl bg-slate-900 px-4 py-3">
        <p className="text-sm font-bold text-slate-50">Agent 5 Assistant</p>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-200">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                m.role === "user" ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text}
              {m.simulated && <p className="mt-1 text-[10px] italic text-slate-400">(simulated — no API key configured)</p>}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
              <Loader2 size={11} className="animate-spin" /> Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about your shipments..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs"
        />
        <button onClick={handleSend} disabled={sending || !input.trim()} className="flex items-center justify-center rounded-md bg-cyan-600 px-3 text-white hover:bg-cyan-500 disabled:opacity-50">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
