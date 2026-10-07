// Companion & Vision surface: the orchestrator conversation stream. Every assistant
// turn carries the badge of the sub-agent that actually handled it, plus the real
// payload of any autonomous action (flight table, terminal output, saved note...).

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Mic, SendHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import ActionResult from "@/components/ActionResult";
import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import { AGENT_META } from "@/lib/types";
import type { ChatMessage } from "@/lib/types";

const PROMPTS = [
  "Bugün neler yaptın, özet geç",
  "Tarkan Kuzu Kuzu şarkısını aç",
  "İstanbul - Ankara en uygun uçak biletini bul",
  "Terminalden git durumuna bak",
];

export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { send, busy, transcript, listening, toggleListening, voiceSupported, sessionId } = useJarvis();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ b64: string; preview: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const { data: messages, isError } = useQuery({
    queryKey: ["chat-history", sessionId],
    queryFn: () => apiGet<ChatMessage[]>(`/chat/history?session_id=${sessionId}`),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, transcript]);

  const submit = async () => {
    const value = text.trim();
    if ((!value && !image) || busy) return;
    setText("");
    const img = image?.b64 ?? null;
    setImage(null);
    await send(value, img);
  };

  const pickImage = (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Görsel çok büyük", { description: "6 MB altında bir görsel seç." });
      return;
    }
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error("Desteklenmeyen format", { description: "PNG, JPEG veya WEBP yükle." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      setImage({ b64: result.split(",")[1] ?? "", preview: result });
    };
    reader.readAsDataURL(file);
  };

  const clearChat = async () => {
    await apiDelete(`/chat/history?session_id=${sessionId}`);
    void queryClient.invalidateQueries({ queryKey: ["chat-history"] });
    toast.success("Sohbet geçmişi temizlendi");
  };

  const list = messages ?? [];

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="chat-panel">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="font-heading text-sm font-semibold text-slate-100">
          Orkestratör Akışı
          {isError && <span className="ml-2 text-xs font-normal text-amber-400">· geçmiş yüklenemedi</span>}
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void clearChat()}
          title="Sohbeti temizle"
          className="text-slate-500 hover:text-rose-300"
          data-testid="chat-clear-button"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
        data-testid="chat-stream"
        aria-live="polite"
      >
        {list.length === 0 && !busy && (
          <div className="glass-soft rounded-xl p-4" data-testid="chat-empty">
            <p className="text-sm text-slate-300">
              Buradayım. Mikrofona basıp Türkçe konuş, yaz ya da bir ekran görüntüsü at — hatanın
              hangi satırda olduğunu söylerim.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setText(p)}
                  className="rounded-full border border-cyan-500/30 bg-cyan-500/[0.07] px-3 py-1.5 text-xs text-cyan-200 transition-[background-color,border-color] duration-150 hover:border-cyan-400/60 hover:bg-cyan-500/15"
                  data-testid={`chat-prompt-chip-${PROMPTS.indexOf(p)}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {list.map((msg) => {
          const meta = AGENT_META[msg.agent] ?? AGENT_META.companion_vision;
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`animate-rise flex ${isUser ? "justify-end" : "justify-start"}`}
              data-testid={`chat-message-${msg.role}`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-3.5 py-2.5 ${
                  isUser
                    ? "border border-cyan-500/30 bg-cyan-950/40 text-cyan-50"
                    : "border border-blue-500/20 bg-[#0f172a]/85 text-slate-100 shadow-md"
                }`}
              >
                {!isUser && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[0.6rem] tracking-widest ${meta.tone}`}
                      data-testid={`agent-badge-${msg.agent.replace(/_/g, "-")}`}
                    >
                      {meta.short}
                    </span>
                    <span className="text-[0.65rem] text-slate-500">{meta.label}</span>
                  </div>
                )}
                {isUser ? (
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                ) : (
                  <Markdown text={msg.content} />
                )}
                {msg.actions.length > 0 && (
                  <div className="mt-2.5 space-y-2">
                    {msg.actions.map((action, i) => (
                      <ActionResult key={`${msg.id}-${i}`} action={action} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {listening && transcript && (
          <div className="flex justify-end" data-testid="chat-live-transcript">
            <div className="max-w-[80%] rounded-xl border border-dashed border-cyan-500/40 bg-cyan-950/20 px-3.5 py-2 text-sm italic text-cyan-200/80">
              {transcript}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 px-1 text-xs text-cyan-300" data-testid="chat-thinking">
            <Loader2 size={13} className="animate-spin" />
            Ajanları çalıştırıyorum...
          </div>
        )}
      </div>

      {image && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#0b1528]/70 p-2" data-testid="chat-image-preview">
          <img src={image.preview} alt="Yüklenen görsel" className="h-14 w-20 rounded object-cover" />
          <span className="flex-1 text-xs text-slate-400">
            Görsel hazır — ne sormak istediğini yaz, ya da boş bırak, ben çözümlerim.
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setImage(null)}
            className="text-slate-400 hover:text-rose-300"
            data-testid="chat-image-remove"
          >
            <X size={14} />
          </Button>
        </div>
      )}

      <div className={`mt-2 flex items-end gap-2 ${compact ? "" : "pt-1"}`}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickImage(file);
            e.target.value = "";
          }}
          data-testid="chat-image-input"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          className="shrink-0 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
          title="Ekran görüntüsü / kod görseli yükle"
          data-testid="chat-image-button"
        >
          <ImagePlus size={17} />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="JARVIS'e yaz... (Enter gönderir)"
          className="max-h-32 min-h-[42px] resize-none border-cyan-500/20 bg-[#050b17]/80 text-sm placeholder:text-slate-600"
          data-testid="chat-input"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={toggleListening}
          disabled={!voiceSupported}
          className={`shrink-0 ${
            listening
              ? "border-rose-500/50 bg-rose-500/15 text-rose-300"
              : "border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
          }`}
          title="Sesli komut"
          data-testid="chat-mic-button"
        >
          <Mic size={17} />
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={busy || (!text.trim() && !image)}
          className="shrink-0 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
          data-testid="chat-send-button"
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <SendHorizontal size={17} />}
        </Button>
      </div>
    </section>
  );
}
