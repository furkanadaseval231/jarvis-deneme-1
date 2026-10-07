// Settings: persona name, Turkish voice selection, auto-speak, watched folders, rules.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2, RotateCcw, Save, Volume2 } from "lucide-react";
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

        <div className="space-y-2.5 rounded-lg border border-cyan-500/20 bg-[#050b17]/60 p-3">
          <div className="mono-label">OTONOM DAVRANIŞLAR</div>

          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <Checkbox
              checked={draft.wake_word_enabled}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, wake_word_enabled: checked === true })
              }
              className="mt-0.5"
              data-testid="settings-wake-word"
            />
            <span>
              Uyandırma sözcüğü: “Hey Jarvis”
              <span className="block text-[0.7rem] text-slate-500">
                Mikrofon arka planda dinler, sadece adını duyunca komut moduna geçer. Sekmeyi
                kapatınca durur. Chrome/Edge gerekir.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <Checkbox
              checked={draft.morning_brief_enabled}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, morning_brief_enabled: checked === true })
              }
              className="mt-0.5"
              data-testid="settings-morning-brief"
            />
            <span>
              Sabah brifingi (09:00)
              <span className="block text-[0.7rem] text-slate-500">
                Uygulama kapalıyken bile sunucuda hazırlanır; açtığında seni sesli karşılar.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <Checkbox
              checked={draft.commit_watch_enabled}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, commit_watch_enabled: checked === true })
              }
              className="mt-0.5"
              data-testid="settings-commit-watch"
            />
            <span>
              Commit izleme
              <span className="block text-[0.7rem] text-slate-500">
                İzlenen klasörleri tarar; yeni commit'te bildirim ve akış kaydı düşer. Uygulama
                açıkken 2 dakikada bir, kapalıyken sunucuda 15 dakikada bir.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-3 rounded-lg border border-amber-500/25 bg-[#050b17]/60 p-3">
          <div className="flex items-center gap-2">
            <Coins size={14} className="text-amber-400" />
            <span className="mono-label text-amber-400">MODEL POLİTİKASI & KREDİ</span>
          </div>
          <p className="text-[0.7rem] leading-relaxed text-slate-500">
            Flash modeli Pro'dan yaklaşık 7 kat ucuz. Basit sohbetleri ona yönlendirmek
            kredini çok daha uzun süre idare ettirir; görsel analizi ve araç gerektiren
            teknik işler otomatik olarak kaliteli modelde kalır.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-300">Model seçimi</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: "auto", label: "Otomatik", hint: "önerilen" },
                  { id: "economy", label: "Ekonomi", hint: "en ucuz" },
                  { id: "quality", label: "Kalite", hint: "en iyi" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, model_mode: opt.id })}
                  data-selected={draft.model_mode === opt.id ? "true" : undefined}
                  className={`rounded-lg border px-2 py-2 text-center transition-[background-color,border-color] duration-150 ${
                    draft.model_mode === opt.id
                      ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                      : "border-white/[0.08] text-slate-400 hover:bg-white/[0.04]"
                  }`}
                  data-testid={`settings-model-mode-${opt.id}`}
                >
                  <span className="block text-xs font-semibold">{opt.label}</span>
                  <span className="block text-[0.6rem] text-slate-500">{opt.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-[0.68rem] text-slate-500">
              {draft.model_mode === "auto"
                ? "Basit sohbet → Flash, teknik iş ve görsel → Pro. Dengeli seçim."
                : draft.model_mode === "economy"
                  ? "Her şey Flash'ta — görsel analizi hariç, o kalitede kalır."
                  : "Her şey Pro'da. En iyi sonuç, en hızlı kredi tüketimi."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Ekonomi modeli</Label>
              <Select
                value={draft.economy_model}
                onValueChange={(value: string) => setDraft({ ...draft, economy_model: value })}
              >
                <SelectTrigger
                  className="border-cyan-500/20 bg-[#050b17] text-xs"
                  data-testid="settings-economy-model"
                >
                  <SelectValue>{(v) => String(v ?? draft.economy_model)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(models ?? [])
                    .filter((m) => m.tier === "economy")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Kaliteli model</Label>
              <Select
                value={draft.quality_model}
                onValueChange={(value: string) => setDraft({ ...draft, quality_model: value })}
              >
                <SelectTrigger
                  className="border-cyan-500/20 bg-[#050b17] text-xs"
                  data-testid="settings-quality-model"
                >
                  <SelectValue>{(v) => String(v ?? draft.quality_model)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(models ?? [])
                    .filter((m) => m.tier === "quality")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {models && models.length > 0 && (
            <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2">
              <div className="mono-label mb-1">1 MİLYON TOKEN FİYATI (KREDİ)</div>
              {models.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between py-0.5 text-[0.68rem]"
                  data-testid={`model-price-${m.id}`}
                >
                  <span className="truncate font-mono text-slate-400">{m.id}</span>
                  <span className="ml-2 shrink-0 font-mono text-slate-200">
                    girdi {m.input_price.toFixed(2)} · çıktı {m.output_price.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="credit-cap" className="text-xs text-slate-300">
              Kredi sınırı (göstergenin tabanı)
            </Label>
            <Input
              id="credit-cap"
              type="number"
              step="0.5"
              min="0.1"
              value={draft.credit_cap}
              onChange={(e) =>
                setDraft({ ...draft, credit_cap: Number(e.target.value) || draft.credit_cap })
              }
              className="border-cyan-500/20 bg-[#050b17] font-mono text-xs"
              data-testid="settings-credit-cap"
            />
            <p className="text-[0.68rem] text-slate-500">
              Emergent panelindeki Universal Key bakiyenle aynı sayıyı gir; gösterge buna göre
              uyarır.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => resetUsage.mutate()}
            disabled={resetUsage.isPending}
            className="w-full gap-2 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
            data-testid="settings-reset-usage"
          >
            {resetUsage.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Kredi sayacını sıfırla (yükleme sonrası)
          </Button>
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
