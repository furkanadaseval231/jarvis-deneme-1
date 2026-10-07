// Settings: persona name, Turkish voice selection, auto-speak, watched folders, rules.

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import type { Settings, TrVoice } from "@/lib/types";

export default function SettingsPanel() {
  const { settings, setSettings, speak } = useJarvis();
  const [draft, setDraft] = useState<Settings | null>(settings);

  const { data: fetched } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<Settings>("/settings"),
  });

  const { data: voiceList } = useQuery({
    queryKey: ["tr-voices"],
    queryFn: () => apiGet<{ voices: TrVoice[]; available: boolean }>("/voice/voices"),
  });

  useEffect(() => {
    if (fetched && !draft) setDraft(fetched);
  }, [fetched, draft]);

  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => apiPatch<Settings>("/settings", body),
    onSuccess: (data) => {
      setDraft(data);
      setSettings(data);
      toast.success("Ayarlar kaydedildi");
    },
    onError: () => toast.error("Ayarlar kaydedilemedi"),
  });

  const voices = voiceList?.voices ?? [{ name: "tr-TR-AhmetNeural", gender: "Male", locale: "tr-TR" }];

  if (!draft) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-3" data-testid="settings-panel">
        <h2 className="font-heading text-sm font-semibold text-slate-100">Sistem Ayarları</h2>
        <p className="glass-soft rounded-xl p-4 text-sm text-slate-400" data-testid="settings-loading">
          Ayarlar yükleniyor... Arka uç kapalıysa bu alan boş kalır, panelin kalanı çalışmaya devam eder.
        </p>
      </section>
    );
  }

  return (
    <section className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="settings-panel">
      <div>
        <h2 className="font-heading text-sm font-semibold text-slate-100">Sistem Ayarları</h2>
        <p className="text-xs text-slate-500">Çalışma kuralları, ses tercihleri ve izlenen klasörler.</p>
      </div>

      <div className="glass-panel space-y-4 rounded-xl p-4">
        <div className="space-y-1.5">
          <Label htmlFor="user-name" className="text-xs text-slate-300">
            Sana nasıl hitap etsin?
          </Label>
          <Input
            id="user-name"
            value={draft.user_name}
            onChange={(e) => setDraft({ ...draft, user_name: e.target.value })}
            className="border-cyan-500/20 bg-[#050b17] text-sm"
            data-testid="settings-username-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">JARVIS sesi (Edge-TTS · Türkçe)</Label>
          <div className="flex gap-2">
            <Select
              value={draft.voice}
              onValueChange={(value: string) => setDraft({ ...draft, voice: value })}
            >
              <SelectTrigger
                className="flex-1 border-cyan-500/20 bg-[#050b17] text-sm"
                data-testid="settings-voice-select"
              >
                <SelectValue>{(v) => String(v ?? draft.voice)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.name} value={v.name}>
                    {v.name} {v.gender ? `(${v.gender === "Male" ? "erkek" : "kadın"})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() =>
                void speak(
                  `Merhaba ${draft.user_name}. Ben JARVIS. Ses testi tamamlandı, sistemler hazır.`,
                )
              }
              className="shrink-0 gap-2 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
              data-testid="settings-voice-test"
            >
              <Volume2 size={15} /> Test
            </Button>
          </div>
          {voiceList && !voiceList.available && (
            <p className="text-[0.7rem] text-amber-400">
              Edge-TTS ses listesine ulaşılamadı; varsayılan Ahmet sesi kullanılıyor.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2.5 text-sm text-slate-300">
            <Checkbox
              checked={draft.voice_enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, voice_enabled: checked === true })}
              data-testid="settings-voice-enabled"
            />
            Sesli yanıt açık
          </label>
          <label className="flex items-center gap-2.5 text-sm text-slate-300">
            <Checkbox
              checked={draft.auto_speak}
              onCheckedChange={(checked) => setDraft({ ...draft, auto_speak: checked === true })}
              data-testid="settings-auto-speak"
            />
            Her yanıtı otomatik sesli oku
          </label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="watch-dirs" className="text-xs text-slate-300">
            İzlenen klasörler (virgülle ayır)
          </Label>
          <Input
            id="watch-dirs"
            value={draft.watch_dirs.join(", ")}
            onChange={(e) =>
              setDraft({
                ...draft,
                watch_dirs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
            className="border-cyan-500/20 bg-[#050b17] font-mono text-xs"
            data-testid="settings-watchdirs-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rules" className="text-xs text-slate-300">
            Özel çalışma kuralları (JARVIS bunları her oturumda hatırlar)
          </Label>
          <Textarea
            id="rules"
            value={draft.rules}
            onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
            rows={4}
            placeholder="örn. Kod örneklerini her zaman TypeScript ver. Sabah 9'dan önce müzik açma."
            className="resize-none border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="settings-rules-input"
          />
        </div>

        <Button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="w-full gap-2 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
          data-testid="settings-save-button"
        >
          {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Ayarları Kaydet
        </Button>
      </div>

      <div className="glass-soft rounded-xl p-3.5 text-xs text-slate-400" data-testid="settings-info">
        <div className="mono-label mb-1.5">ÇEKİRDEK BİLGİSİ</div>
        <p>Beyin: Gemini 3 (gemini-3.1-pro-preview) · canlı Google Search grounding açık</p>
        <p>Ses: Edge-TTS Türkçe nöral ses, tarayıcı Web Speech API yedeğiyle</p>
        <p>Terminal: /app sandbox · yıkıcı komutlarda onay zorunlu</p>
      </div>
    </section>
  );
}
