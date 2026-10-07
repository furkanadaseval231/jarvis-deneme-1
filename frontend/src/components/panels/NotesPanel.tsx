// Research & Study Agent surface: live-grounded digests, saved as notes.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Note } from "@/lib/types";

export default function NotesPanel() {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const notes = useQuery({ queryKey: ["notes"], queryFn: () => apiGet<Note[]>("/notes") });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["notes"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
    void queryClient.invalidateQueries({ queryKey: ["metrics"] });
  };

  const research = useMutation({
    mutationFn: (t: string) => apiPost<Note>("/research", { topic: t }),
    onSuccess: (note) => {
      setTopic("");
      setOpenId(note.id);
      invalidate();
      toast.success("Hap özet hazır", { description: note.title });
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      toast.error("Araştırma yapılamadı", {
        description: detail || "Ağ bağlantını kontrol et, sonra tekrar dene.",
      });
    },
  });

  const addNote = useMutation({
    mutationFn: (vars: { title: string; content: string }) =>
      apiPost<Note>("/notes", { ...vars, source: "manual" }),
    onSuccess: () => {
      setManualTitle("");
      setManualBody("");
      invalidate();
      toast.success("Not kaydedildi");
    },
    onError: () => toast.error("Not kaydedilemedi"),
  });

  const removeNote = useMutation({
    mutationFn: (id: string) => apiDelete(`/notes/${id}`),
    onSuccess: invalidate,
  });

  return (
    <section className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="notes-panel">
      <div>
        <h2 className="font-heading text-sm font-semibold text-slate-100">Araştırma Notları</h2>
        <p className="text-xs text-slate-500">
          Karmaşık konuyu canlı aramayla tarar, hap özete indirir ve buraya kaydeder.
        </p>
      </div>

      <div className="glass-panel rounded-xl p-3">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={14} className="text-amber-400" />
          <span className="mono-label text-amber-400">HAP ÖZET ÜRET</span>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (topic.trim()) research.mutate(topic.trim());
          }}
        >
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="örn. Rust ownership modeli, transformer attention..."
            className="h-9 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="research-topic-input"
          />
          <Button
            type="submit"
            disabled={research.isPending || !topic.trim()}
            className="h-9 shrink-0 gap-2 bg-amber-500 text-[#201400] hover:bg-amber-400"
            data-testid="research-run-button"
          >
            {research.isPending ? <Loader2 size={14} className="animate-spin" /> : <BookOpenCheck size={14} />}
            Araştır
          </Button>
        </form>
        {research.isPending && (
          <p className="mt-2 text-xs text-amber-300">Canlı kaynaklar taranıyor, biraz sürebilir...</p>
        )}
      </div>

      <div className="glass-panel rounded-xl p-3">
        <div className="mono-label mb-2">KENDİ NOTUNU EKLE</div>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manualTitle.trim() && manualBody.trim()) {
              addNote.mutate({ title: manualTitle.trim(), content: manualBody.trim() });
            }
          }}
        >
          <Input
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Başlık"
            className="h-9 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="note-title-input"
          />
          <Textarea
            value={manualBody}
            onChange={(e) => setManualBody(e.target.value)}
            placeholder="Not içeriği..."
            rows={3}
            className="resize-none border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="note-body-input"
          />
          <Button
            type="submit"
            disabled={addNote.isPending || !manualTitle.trim() || !manualBody.trim()}
            className="w-full bg-cyan-500 text-[#021018] hover:bg-cyan-400"
            data-testid="note-save-button"
          >
            Kaydet
          </Button>
        </form>
      </div>

      <div className="space-y-2" data-testid="note-list">
        <div className="mono-label">KAYITLI NOTLAR ({notes.data?.length ?? 0})</div>
        {notes.isError && (
          <p className="text-xs text-amber-400">Notlar yüklenemedi — arka uç yanıt vermiyor.</p>
        )}
        {(notes.data ?? []).map((n) => {
          const open = openId === n.id;
          return (
            <div key={n.id} className="glass-soft rounded-lg" data-testid={`note-item-${n.id}`}>
              <div className="flex items-center gap-2 p-2.5">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : n.id)}
                  className="min-w-0 flex-1 text-left"
                  data-testid={`note-toggle-${n.id}`}
                >
                  <span className="block truncate text-sm font-medium text-slate-100">{n.title}</span>
                  <span className="text-[0.68rem] text-slate-500">
                    {n.source === "research" ? "canlı araştırma" : "manuel not"} ·{" "}
                    {new Date(n.created_at).toLocaleDateString("tr-TR")}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeNote.mutate(n.id)}
                  className="shrink-0 text-slate-600 hover:text-rose-300"
                  data-testid={`note-delete-${n.id}`}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
              {open && (
                <div className="border-t border-cyan-500/15 p-3" data-testid={`note-content-${n.id}`}>
                  <Markdown text={n.content} />
                </div>
              )}
            </div>
          );
        })}
        {notes.data?.length === 0 && (
          <p className="text-xs text-slate-500">Henüz not yok. Yukarıdan bir konu araştır.</p>
        )}
      </div>
    </section>
  );
}
